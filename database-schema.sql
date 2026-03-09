-- ================================
-- FITNESS APP - COMPLETE DATABASE SCHEMA
-- Vercel Postgres Production Ready
-- ================================

-- Enable UUID extension (if needed)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================
-- TABLE 1: USERS
-- ================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  profile_photo TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_google_id ON users(google_id);
CREATE INDEX idx_users_email ON users(email);

-- ================================
-- TABLE 2: USER PROFILES
-- ================================
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Basic Info
  gender VARCHAR(10), -- 'male', 'female', 'other'
  age INT,
  height DECIMAL(5,2), -- in cm
  current_weight DECIMAL(5,2), -- in kg
  
  -- Goals
  target_weight DECIMAL(5,2), -- in kg
  goal_deadline DATE,
  weekly_weight_loss_goal DECIMAL(3,2), -- in kg (e.g., 0.5, 1.0)
  daily_calorie_target INT,
  daily_water_goal INT, -- in ml
  
  -- Activity
  activity_level VARCHAR(50), -- 'sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extremely_active'
  workout_days_per_week INT,
  rest_days JSONB, -- ["monday", "wednesday"]
  cheat_day VARCHAR(20), -- 'sunday', 'saturday', etc.
  preferred_workout_time VARCHAR(20), -- 'morning', 'afternoon', 'evening'
  
  -- Macros (auto-calculated)
  protein_target DECIMAL(5,2), -- in grams
  carbs_target DECIMAL(5,2), -- in grams
  fat_target DECIMAL(5,2), -- in grams
  
  -- Onboarding Status
  onboarding_completed BOOLEAN DEFAULT FALSE,
  current_step INT DEFAULT 1,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_profiles_user_id ON user_profiles(user_id);

-- ================================
-- TABLE 3: EXERCISES
-- ================================
CREATE TABLE exercises (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  body_part VARCHAR(50) NOT NULL,
  target_muscle VARCHAR(100) NOT NULL,
  equipment VARCHAR(100) NOT NULL,
  
  -- Classification
  difficulty VARCHAR(20) NOT NULL DEFAULT 'intermediate',
  exercise_type VARCHAR(50) NOT NULL DEFAULT 'strength',
  
  -- Content
  instructions TEXT NOT NULL,
  secondary_muscles JSONB,
  
  -- Calorie Calculation
  met_value DECIMAL(4,2) DEFAULT 6.0,
  
  -- Video Integration
  youtube_video_id VARCHAR(50),
  video_source VARCHAR(20), -- 'manual', 'auto_search'
  video_search_query VARCHAR(255),
  video_title VARCHAR(255),
  video_duration_seconds INT,
  video_fetched_at TIMESTAMP,
  video_view_count INT DEFAULT 0,
  
  -- Metadata
  source VARCHAR(50) DEFAULT 'ExerciseDB',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_exercises_body_part ON exercises(body_part);
CREATE INDEX idx_exercises_equipment ON exercises(equipment);
CREATE INDEX idx_exercises_target_muscle ON exercises(target_muscle);
CREATE INDEX idx_exercises_difficulty ON exercises(difficulty);

-- ================================
-- TABLE 4: WORKOUTS
-- ================================
CREATE TABLE workouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id VARCHAR(50) NOT NULL REFERENCES exercises(id),
  exercise_name VARCHAR(255) NOT NULL,
  
  -- Set Details (stored as JSONB array)
  -- Example: [{"set": 1, "reps": 10, "weight": 50}, {"set": 2, "reps": 8, "weight": 55}]
  sets JSONB NOT NULL,
  
  -- Totals
  duration_minutes INT,
  calories_burned INT,
  total_volume DECIMAL(10,2), -- sum of (reps × weight) for all sets
  total_reps INT, -- total reps across all sets
  
  -- Notes
  notes TEXT,
  
  -- Timestamps
  completed_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_workouts_user_id ON workouts(user_id);
CREATE INDEX idx_workouts_exercise_id ON workouts(exercise_id);
CREATE INDEX idx_workouts_completed_at ON workouts(completed_at);
CREATE INDEX idx_workouts_user_completed ON workouts(user_id, completed_at);

-- ================================
-- TABLE 5: FOOD LOGS
-- ================================
CREATE TABLE food_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Food Details
  food_name VARCHAR(255) NOT NULL,
  calories DECIMAL(7,2) NOT NULL,
  protein DECIMAL(6,2) DEFAULT 0,
  carbs DECIMAL(6,2) DEFAULT 0,
  fat DECIMAL(6,2) DEFAULT 0,
  
  -- Meal Info
  meal_type VARCHAR(50), -- 'breakfast', 'lunch', 'dinner', 'snack'
  serving_size VARCHAR(100),
  quantity DECIMAL(5,2) DEFAULT 1,
  
  -- Source tracking
  food_source VARCHAR(50), -- 'indian_db', 'fatsecret', 'usda', 'openfoodfacts', 'manual'
  
  -- Timestamps
  logged_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_food_logs_user_id ON food_logs(user_id);
CREATE INDEX idx_food_logs_logged_at ON food_logs(logged_at);
CREATE INDEX idx_food_logs_user_logged ON food_logs(user_id, logged_at);
CREATE INDEX idx_food_logs_meal_type ON food_logs(meal_type);

-- ================================
-- TABLE 6: WEIGHT HISTORY
-- ================================
CREATE TABLE weight_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weight DECIMAL(5,2) NOT NULL, -- in kg
  
  -- Timestamps
  recorded_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_weight_user_id ON weight_history(user_id);
CREATE INDEX idx_weight_recorded_at ON weight_history(recorded_at);
CREATE INDEX idx_weight_user_recorded ON weight_history(user_id, recorded_at);

-- ================================
-- TABLE 7: WATER LOGS
-- ================================
CREATE TABLE water_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_ml INT NOT NULL, -- in milliliters
  
  -- Timestamps
  logged_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_water_user_id ON water_logs(user_id);
CREATE INDEX idx_water_logged_at ON water_logs(logged_at);
CREATE INDEX idx_water_user_logged ON water_logs(user_id, logged_at);

-- ================================
-- TABLE 8: SEARCH INTELLIGENCE
-- (Learns from successful food searches)
-- ================================
CREATE TABLE search_intelligence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Search Data
  original_query VARCHAR(255) NOT NULL,
  successful_translation VARCHAR(255),
  selected_result_name VARCHAR(255) NOT NULL,
  
  -- Nutritional Data
  calories DECIMAL(7,2),
  protein DECIMAL(6,2),
  carbs DECIMAL(6,2),
  fat DECIMAL(6,2),
  
  -- Learning Metrics
  times_selected INT DEFAULT 1,
  confidence_score DECIMAL(3,2) DEFAULT 1.0, -- 0.0 to 1.0
  
  -- Source
  food_source VARCHAR(50),
  
  -- Timestamps
  first_searched_at TIMESTAMP DEFAULT NOW(),
  last_searched_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_search_intelligence_original ON search_intelligence(original_query);
CREATE INDEX idx_search_intelligence_translation ON search_intelligence(successful_translation);

-- ================================
-- TABLE 9: TRANSLATION CACHE
-- (Cache translation results to save API calls)
-- ================================
CREATE TABLE translation_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_text VARCHAR(255) UNIQUE NOT NULL,
  translated_text VARCHAR(255) NOT NULL,
  source_language VARCHAR(10), -- 'te', 'hi', 'ta', etc.
  target_language VARCHAR(10) DEFAULT 'en',
  
  -- Usage Stats
  times_used INT DEFAULT 1,
  last_used TIMESTAMP DEFAULT NOW(),
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_translation_cache_source ON translation_cache(source_text);

-- ================================
-- TABLE 10: INDIAN FOODS DATABASE
-- (Pre-loaded Indian food items)
-- ================================
CREATE TABLE indian_foods (
  id SERIAL PRIMARY KEY,
  
  -- Names
  name VARCHAR(255) NOT NULL,
  name_hindi VARCHAR(255),
  name_telugu VARCHAR(255),
  name_tamil VARCHAR(255),
  name_kannada VARCHAR(255),
  
  -- Nutritional Info (per 100g)
  calories DECIMAL(7,2) NOT NULL,
  protein DECIMAL(6,2) DEFAULT 0,
  carbs DECIMAL(6,2) DEFAULT 0,
  fat DECIMAL(6,2) DEFAULT 0,
  fiber DECIMAL(6,2) DEFAULT 0,
  
  -- Serving Info
  serving_size VARCHAR(100) DEFAULT '100g',
  serving_size_grams INT DEFAULT 100,
  
  -- Classification
  category VARCHAR(50), -- 'north_indian', 'south_indian', 'snacks', 'beverages', 'sweets'
  subcategory VARCHAR(100), -- 'rice_dishes', 'curries', 'breads', 'lentils'
  
  -- Metadata
  source VARCHAR(50) DEFAULT 'IFCT', -- 'IFCT', 'NIN', 'manual'
  is_vegetarian BOOLEAN DEFAULT TRUE,
  is_vegan BOOLEAN DEFAULT FALSE,
  
  -- Search optimization
  search_keywords TEXT, -- Additional search terms
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_indian_foods_name ON indian_foods(name);
CREATE INDEX idx_indian_foods_category ON indian_foods(category);
CREATE INDEX idx_indian_foods_subcategory ON indian_foods(subcategory);

-- ================================
-- TRIGGER: Update updated_at timestamp
-- ================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_exercises_updated_at BEFORE UPDATE ON exercises
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_indian_foods_updated_at BEFORE UPDATE ON indian_foods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================
-- INITIAL DATA LOAD COMPLETE
-- Next: Run exercises-data.sql to import 300 exercises
-- ================================
