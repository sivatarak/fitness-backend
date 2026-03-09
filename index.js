require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const sql = require("./api/db");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ================================
// FATSECRET CONFIG
// ================================

const CLIENT_ID = process.env.FATSECRET_CLIENT_ID;
const CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET;

let accessToken = null;
let tokenExpiry = 0;

// ================================
// TRANSLATION FUNCTION
// ================================

const translate = require("google-translate-api-x");

async function translateToEnglish(text) {
  try {
    // Check translation cache first
    const cached = await sql`
      SELECT translated_text 
      FROM translation_cache 
      WHERE source_text = ${text.toLowerCase()}
    `;

    if (cached.length > 0) {
      // Update usage stats
      await sql`
        UPDATE translation_cache 
        SET times_used = times_used + 1, last_used = NOW() 
        WHERE source_text = ${text.toLowerCase()}
      `;
      console.log("Translation from cache:", cached[0].translated_text);
      return cached[0].translated_text;
    }

    // First translation
    let result = await translate(text, { to: "en" });
    let translated = result.text.toLowerCase();

    console.log("Translated step1:", translated);

    // If it looks like transliteration, try again
    if (translated === text.toLowerCase()) {
      const retry = await translate(translated, { from: "te", to: "en" });
      translated = retry.text.toLowerCase();
      console.log("Translated step2:", translated);
    }

    // Cache the translation
    await sql`
      INSERT INTO translation_cache (source_text, translated_text, times_used)
      VALUES (${text.toLowerCase()}, ${translated}, 1)
      ON CONFLICT (source_text) DO UPDATE
      SET translated_text = ${translated}, times_used = translation_cache.times_used + 1, last_used = NOW()
    `;

    return translated;
  } catch (error) {
    console.log("Translation error:", error.message);
    return text.toLowerCase();
  }
}

// ================================
// FATSECRET TOKEN
// ================================

async function getFatSecretToken() {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  try {
    const response = await axios.post(
      "https://oauth.fatsecret.com/connect/token",
      new URLSearchParams({
        grant_type: "client_credentials",
        scope: "basic"
      }),
      {
        auth: {
          username: CLIENT_ID,
          password: CLIENT_SECRET
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    accessToken = response.data.access_token;
    tokenExpiry = Date.now() + response.data.expires_in * 1000;

    console.log("FatSecret token refreshed");

    return accessToken;
  } catch (error) {
    console.log("FatSecret token error");
    return null;
  }
}

// ================================
// FATSECRET SEARCH
// ================================

async function searchFatSecret(query) {
  try {
    const token = await getFatSecretToken();
    if (!token) return [];

    const response = await axios.post(
      "https://platform.fatsecret.com/rest/server.api",
      null,
      {
        params: {
          method: "foods.search.v4",
          search_expression: query,
          format: "json"
        },
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const foods = response.data?.foods_search?.results?.food || [];
    const list = Array.isArray(foods) ? foods : [foods];

    return list.slice(0, 5).map(f => {
      const serving = Array.isArray(f.servings?.serving)
        ? f.servings.serving[0]
        : f.servings?.serving;

      return {
        name: f.food_name,
        calories: Number(serving?.calories || 0),
        protein: Number(serving?.protein || 0),
        carbs: Number(serving?.carbohydrate || 0),
        fat: Number(serving?.fat || 0),
        source: "fatsecret"
      };
    });
  } catch (error) {
    console.log("FatSecret search failed");
    return [];
  }
}

// ================================
// USDA SEARCH
// ================================

async function searchUSDA(query) {
  try {
    const response = await axios.get(
      `https://api.nal.usda.gov/fdc/v1/foods/search`,
      {
        params: {
          api_key: process.env.USDA_API_KEY,
          query: query,
          pageSize: 5
        }
      }
    );

    return response.data.foods.map(f => {
      const nutrients = f.foodNutrients;
      const get = name => nutrients.find(n => n.nutrientName === name)?.value || 0;

      return {
        name: f.description,
        calories: get("Energy"),
        protein: get("Protein"),
        carbs: get("Carbohydrate, by difference"),
        fat: get("Total lipid (fat)"),
        source: "usda"
      };
    });
  } catch {
    console.log("USDA search failed");
    return [];
  }
}

// ================================
// OPEN FOOD FACTS SEARCH
// ================================

async function searchOpenFoodFacts(query) {
  try {
    const response = await axios.get(
      `https://world.openfoodfacts.org/cgi/search.pl`,
      {
        params: {
          search_terms: query,
          search_simple: 1,
          action: "process",
          json: 1,
          page_size: 5
        }
      }
    );

    return response.data.products.map(p => ({
      name: p.product_name,
      calories: p.nutriments?.["energy-kcal_100g"] || 0,
      protein: p.nutriments?.proteins_100g || 0,
      carbs: p.nutriments?.carbohydrates_100g || 0,
      fat: p.nutriments?.fat_100g || 0,
      source: "openfoodfacts"
    }));
  } catch {
    console.log("OpenFoodFacts search failed");
    return [];
  }
}

// ================================
// SEARCH INDIAN FOODS DATABASE
// ================================

async function searchIndianFoods(query) {
  try {
    const results = await sql`
      SELECT 
        name, 
        calories, 
        protein, 
        carbs, 
        fat, 
        serving_size,
        'indian_db' as source
      FROM indian_foods
      WHERE 
        name ILIKE ${'%' + query + '%'} 
        OR name_hindi ILIKE ${'%' + query + '%'}
        OR name_telugu ILIKE ${'%' + query + '%'}
        OR search_keywords ILIKE ${'%' + query + '%'}
      LIMIT 5
    `;

    return results.map(r => ({
      name: r.name,
      calories: Number(r.calories),
      protein: Number(r.protein),
      carbs: Number(r.carbs),
      fat: Number(r.fat),
      serving_size: r.serving_size,
      source: 'indian_db'
    }));
  } catch (error) {
    console.log("Indian foods search failed:", error.message);
    return [];
  }
}

// ================================
// MAIN FOOD SEARCH ROUTE
// ================================

app.get("/api/food/search", async (req, res) => {
  try {
    let query = req.query.q;

    if (!query) {
      return res.status(400).json({ error: "query required" });
    }

    console.log("User search:", query);

    // Check search intelligence first
    const learned = await sql`
      SELECT * FROM search_intelligence
      WHERE original_query = ${query.toLowerCase()}
      ORDER BY times_selected DESC, confidence_score DESC
      LIMIT 1
    `;

    if (learned.length > 0) {
      console.log("Using learned search result");
      await sql`
        UPDATE search_intelligence 
        SET times_selected = times_selected + 1, last_searched_at = NOW()
        WHERE id = ${learned[0].id}
      `;
      return res.json([{
        name: learned[0].selected_result_name,
        calories: Number(learned[0].calories),
        protein: Number(learned[0].protein),
        carbs: Number(learned[0].carbs),
        fat: Number(learned[0].fat),
        source: learned[0].food_source
      }]);
    }

    // Translate query
    query = await translateToEnglish(query);
    console.log("Searching for:", query);

    // PRIORITY 1: Search Indian foods database
    let results = await searchIndianFoods(query);

    // PRIORITY 2: FatSecret
    if (results.length === 0) {
      results = await searchFatSecret(query);
    }

    // PRIORITY 3: USDA
    if (results.length === 0) {
      results = await searchUSDA(query);
    }

    // PRIORITY 4: OpenFoodFacts
    if (results.length === 0) {
      results = await searchOpenFoodFacts(query);
    }

    res.json(results);
  } catch (error) {
    console.log("Search error:", error.message);
    res.status(500).json({ error: "Food search failed" });
  }
});

// ================================
// LOG FOOD ENTRY
// ================================

app.post("/api/food/log", async (req, res) => {
  try {
    const { userId, foodName, calories, protein, carbs, fat, mealType, servingSize, quantity, foodSource } = req.body;

    if (!userId || !foodName || !calories) {
      return res.status(400).json({ error: "userId, foodName, and calories required" });
    }

    const result = await sql`
      INSERT INTO food_logs (
        user_id, food_name, calories, protein, carbs, fat, 
        meal_type, serving_size, quantity, food_source, logged_at
      ) VALUES (
        ${userId}, ${foodName}, ${calories}, ${protein || 0}, ${carbs || 0}, ${fat || 0},
        ${mealType || 'snack'}, ${servingSize || '100g'}, ${quantity || 1}, ${foodSource || 'manual'}, NOW()
      )
      RETURNING *
    `;

    // Learn from this selection
    await sql`
      INSERT INTO search_intelligence (
        original_query, selected_result_name, calories, protein, carbs, fat, food_source
      ) VALUES (
        ${foodName.toLowerCase()}, ${foodName}, ${calories}, ${protein || 0}, ${carbs || 0}, ${fat || 0}, ${foodSource || 'manual'}
      )
      ON CONFLICT (original_query) DO UPDATE
      SET times_selected = search_intelligence.times_selected + 1, last_searched_at = NOW()
    `;

    res.json(result[0]);
  } catch (error) {
    console.log("Food log error:", error.message);
    res.status(500).json({ error: "Failed to log food" });
  }
});

// ================================
// GET TODAY'S FOOD LOGS
// ================================

app.get("/api/food/logs", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const logs = await sql`
      SELECT * FROM food_logs
      WHERE user_id = ${userId}
        AND DATE(logged_at) = CURRENT_DATE
      ORDER BY logged_at DESC
    `;

    const totals = await sql`
      SELECT 
        COALESCE(SUM(calories * quantity), 0) as total_calories,
        COALESCE(SUM(protein * quantity), 0) as total_protein,
        COALESCE(SUM(carbs * quantity), 0) as total_carbs,
        COALESCE(SUM(fat * quantity), 0) as total_fat
      FROM food_logs
      WHERE user_id = ${userId}
        AND DATE(logged_at) = CURRENT_DATE
    `;

    res.json({
      logs,
      totals: totals[0]
    });
  } catch (error) {
    console.log("Get food logs error:", error.message);
    res.status(500).json({ error: "Failed to get food logs" });
  }
});

// ================================
// GET ALL EXERCISES
// ================================

app.get("/api/exercises", async (req, res) => {
  try {
    const { bodyPart, equipment, difficulty } = req.query;

    let query = sql`SELECT * FROM exercises WHERE 1=1`;

    if (bodyPart) {
      query = sql`SELECT * FROM exercises WHERE body_part = ${bodyPart}`;
    } else if (equipment) {
      query = sql`SELECT * FROM exercises WHERE equipment = ${equipment}`;
    } else if (difficulty) {
      query = sql`SELECT * FROM exercises WHERE difficulty = ${difficulty}`;
    } else {
      query = sql`SELECT * FROM exercises ORDER BY body_part, name LIMIT 100`;
    }

    const exercises = await query;

    res.json(exercises);
  } catch (error) {
    console.log("Get exercises error:", error.message);
    res.status(500).json({ error: "Failed to get exercises" });
  }
});

// ================================
// GET SINGLE EXERCISE (with auto YouTube fetch)
// ================================

app.get("/api/exercises/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const exercise = await sql`
      SELECT * FROM exercises WHERE id = ${id}
    `;

    if (exercise.length === 0) {
      return res.status(404).json({ error: "Exercise not found" });
    }

    let ex = exercise[0];

    // If no YouTube video ID, search for one
    if (!ex.youtube_video_id && process.env.YOUTUBE_API_KEY) {
      try {
        const searchQuery = `${ex.name} proper form tutorial`;
        const youtubeResponse = await axios.get(
          'https://www.googleapis.com/youtube/v3/search',
          {
            params: {
              key: process.env.YOUTUBE_API_KEY,
              q: searchQuery,
              part: 'snippet',
              type: 'video',
              maxResults: 1,
              videoDuration: 'medium' // 4-20 minutes
            }
          }
        );

        if (youtubeResponse.data.items.length > 0) {
          const videoId = youtubeResponse.data.items[0].id.videoId;
          const videoTitle = youtubeResponse.data.items[0].snippet.title;

          // Save to database
          await sql`
            UPDATE exercises
            SET 
              youtube_video_id = ${videoId},
              video_source = 'auto_search',
              video_search_query = ${searchQuery},
              video_title = ${videoTitle},
              video_fetched_at = NOW()
            WHERE id = ${id}
          `;

          ex.youtube_video_id = videoId;
          ex.video_title = videoTitle;
          console.log(`Auto-fetched video for ${ex.name}: ${videoId}`);
        }
      } catch (ytError) {
        console.log("YouTube search failed:", ytError.message);
      }
    }

    // Increment view count
    await sql`
      UPDATE exercises
      SET video_view_count = video_view_count + 1
      WHERE id = ${id}
    `;

    res.json(ex);
  } catch (error) {
    console.log("Get exercise error:", error.message);
    res.status(500).json({ error: "Failed to get exercise" });
  }
});

// ================================
// LOG WORKOUT
// ================================

app.post("/api/workouts", async (req, res) => {
  try {
    const { userId, exerciseId, exerciseName, sets, durationMinutes, notes } = req.body;

    if (!userId || !exerciseId || !sets) {
      return res.status(400).json({ error: "userId, exerciseId, and sets required" });
    }

    // Get exercise MET value
    const exercise = await sql`
      SELECT met_value FROM exercises WHERE id = ${exerciseId}
    `;

    const metValue = exercise[0]?.met_value || 6.0;

    // Get user profile for calorie calculation
    const profile = await sql`
      SELECT current_weight, age, height, gender 
      FROM user_profiles 
      WHERE user_id = ${userId}
    `;

    // Calculate calories burned using MET formula
    let caloriesBurned = 0;
    if (profile.length > 0) {
      const { current_weight, age, height, gender } = profile[0];
      
      // Mifflin-St Jeor BMR
      const bmr = gender === 'male'
        ? (10 * current_weight) + (6.25 * height) - (5 * age) + 5
        : (10 * current_weight) + (6.25 * height) - (5 * age) - 161;
      
      const bmrPerMinute = bmr / 1440;
      caloriesBurned = Math.round(metValue * bmrPerMinute * durationMinutes);
    }

    // Calculate total volume and reps
    let totalVolume = 0;
    let totalReps = 0;
    
    sets.forEach(set => {
      totalReps += set.reps || 0;
      totalVolume += (set.reps || 0) * (set.weight || 0);
    });

    const result = await sql`
      INSERT INTO workouts (
        user_id, exercise_id, exercise_name, sets, 
        duration_minutes, calories_burned, total_volume, total_reps, notes, completed_at
      ) VALUES (
        ${userId}, ${exerciseId}, ${exerciseName}, ${JSON.stringify(sets)},
        ${durationMinutes || 0}, ${caloriesBurned}, ${totalVolume}, ${totalReps}, ${notes || ''}, NOW()
      )
      RETURNING *
    `;

    res.json(result[0]);
  } catch (error) {
    console.log("Log workout error:", error.message);
    res.status(500).json({ error: "Failed to log workout" });
  }
});

// ================================
// GET WORKOUT HISTORY
// ================================

app.get("/api/workouts", async (req, res) => {
  try {
    const { userId, limit = 50 } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const workouts = await sql`
      SELECT * FROM workouts
      WHERE user_id = ${userId}
      ORDER BY completed_at DESC
      LIMIT ${limit}
    `;

    res.json(workouts);
  } catch (error) {
    console.log("Get workouts error:", error.message);
    res.status(500).json({ error: "Failed to get workouts" });
  }
});

// ================================
// LOG WEIGHT
// ================================

app.post("/api/weight", async (req, res) => {
  try {
    const { userId, weight } = req.body;

    if (!userId || !weight) {
      return res.status(400).json({ error: "userId and weight required" });
    }

    const result = await sql`
      INSERT INTO weight_history (user_id, weight, recorded_at)
      VALUES (${userId}, ${weight}, NOW())
      RETURNING *
    `;

    // Update current weight in profile
    await sql`
      UPDATE user_profiles
      SET current_weight = ${weight}, updated_at = NOW()
      WHERE user_id = ${userId}
    `;

    res.json(result[0]);
  } catch (error) {
    console.log("Log weight error:", error.message);
    res.status(500).json({ error: "Failed to log weight" });
  }
});

// ================================
// GET WEIGHT HISTORY
// ================================

app.get("/api/weight/history", async (req, res) => {
  try {
    const { userId, days = 30 } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const history = await sql`
      SELECT * FROM weight_history
      WHERE user_id = ${userId}
        AND recorded_at >= NOW() - INTERVAL '${days} days'
      ORDER BY recorded_at ASC
    `;

    res.json(history);
  } catch (error) {
    console.log("Get weight history error:", error.message);
    res.status(500).json({ error: "Failed to get weight history" });
  }
});

// ================================
// LOG WATER
// ================================

app.post("/api/water", async (req, res) => {
  try {
    const { userId, amountMl } = req.body;

    if (!userId || !amountMl) {
      return res.status(400).json({ error: "userId and amountMl required" });
    }

    const result = await sql`
      INSERT INTO water_logs (user_id, amount_ml, logged_at)
      VALUES (${userId}, ${amountMl}, NOW())
      RETURNING *
    `;

    res.json(result[0]);
  } catch (error) {
    console.log("Log water error:", error.message);
    res.status(500).json({ error: "Failed to log water" });
  }
});

// ================================
// GET TODAY'S WATER INTAKE
// ================================

app.get("/api/water/today", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const result = await sql`
      SELECT COALESCE(SUM(amount_ml), 0) as total_ml
      FROM water_logs
      WHERE user_id = ${userId}
        AND DATE(logged_at) = CURRENT_DATE
    `;

    res.json({ total_ml: Number(result[0].total_ml) });
  } catch (error) {
    console.log("Get water intake error:", error.message);
    res.status(500).json({ error: "Failed to get water intake" });
  }
});

// ================================
// DASHBOARD STATS
// ================================

app.get("/api/dashboard", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // Get today's totals
    const foodTotals = await sql`
      SELECT 
        COALESCE(SUM(calories * quantity), 0) as calories,
        COALESCE(SUM(protein * quantity), 0) as protein,
        COALESCE(SUM(carbs * quantity), 0) as carbs,
        COALESCE(SUM(fat * quantity), 0) as fat
      FROM food_logs
      WHERE user_id = ${userId} AND DATE(logged_at) = CURRENT_DATE
    `;

    const workoutTotals = await sql`
      SELECT 
        COALESCE(SUM(calories_burned), 0) as calories_burned,
        COALESCE(SUM(duration_minutes), 0) as duration_minutes,
        COUNT(*) as workout_count
      FROM workouts
      WHERE user_id = ${userId} AND DATE(completed_at) = CURRENT_DATE
    `;

    const waterTotal = await sql`
      SELECT COALESCE(SUM(amount_ml), 0) as total_ml
      FROM water_logs
      WHERE user_id = ${userId} AND DATE(logged_at) = CURRENT_DATE
    `;

    const profile = await sql`
      SELECT * FROM user_profiles WHERE user_id = ${userId}
    `;

    res.json({
      food: foodTotals[0],
      workouts: workoutTotals[0],
      water: waterTotal[0],
      profile: profile[0] || {},
      net_calories: Number(foodTotals[0].calories) - Number(workoutTotals[0].calories_burned)
    });
  } catch (error) {
    console.log("Dashboard error:", error.message);
    res.status(500).json({ error: "Failed to get dashboard data" });
  }
});

// ================================
// USER PROFILE ENDPOINTS
// ================================

// Create/Update User Profile (Onboarding)
app.post("/api/profile/onboarding", async (req, res) => {
  try {
    const {
      userId,
      gender,
      age,
      height,
      currentWeight,
      targetWeight,
      goalDeadline,
      activityLevel,
      workoutDaysPerWeek,
      restDays,
      cheatDay,
      preferredWorkoutTime
    } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // Calculate daily calorie target using Mifflin-St Jeor
    const bmr = gender === 'male'
      ? (10 * currentWeight) + (6.25 * height) - (5 * age) + 5
      : (10 * currentWeight) + (6.25 * height) - (5 * age) - 161;

    // Activity multipliers
    const activityMultipliers = {
      'sedentary': 1.2,
      'lightly_active': 1.375,
      'moderately_active': 1.55,
      'very_active': 1.725,
      'extremely_active': 1.9
    };

    const tdee = Math.round(bmr * (activityMultipliers[activityLevel] || 1.2));

    // Calculate weekly weight loss goal
    const daysDiff = Math.ceil((new Date(goalDeadline) - new Date()) / (1000 * 60 * 60 * 24));
    const weeksDiff = daysDiff / 7;
    const totalWeightChange = targetWeight - currentWeight;
    const weeklyWeightLossGoal = totalWeightChange / weeksDiff;

    // Calculate daily calorie target (7700 cal = 1kg)
    const dailyDeficit = (weeklyWeightLossGoal * 7700) / 7;
    const dailyCalorieTarget = Math.round(tdee - dailyDeficit);

    // Calculate macros (protein: 2g/kg, fat: 25%, carbs: remainder)
    const proteinTarget = currentWeight * 2; // grams
    const fatTarget = (dailyCalorieTarget * 0.25) / 9; // grams
    const carbsTarget = (dailyCalorieTarget - (proteinTarget * 4) - (fatTarget * 9)) / 4; // grams

    // Calculate water goal (weight × 0.033L)
    const dailyWaterGoal = Math.round(currentWeight * 33); // ml

    // Upsert profile
    const profile = await sql`
      INSERT INTO user_profiles (
        user_id, gender, age, height, current_weight,
        target_weight, goal_deadline, weekly_weight_loss_goal,
        daily_calorie_target, daily_water_goal,
        activity_level, workout_days_per_week, rest_days, cheat_day,
        preferred_workout_time, protein_target, carbs_target, fat_target,
        onboarding_completed, current_step
      ) VALUES (
        ${userId}, ${gender}, ${age}, ${height}, ${currentWeight},
        ${targetWeight}, ${goalDeadline}, ${weeklyWeightLossGoal},
        ${dailyCalorieTarget}, ${dailyWaterGoal},
        ${activityLevel}, ${workoutDaysPerWeek}, ${JSON.stringify(restDays)}, ${cheatDay},
        ${preferredWorkoutTime}, ${proteinTarget}, ${carbsTarget}, ${fatTarget},
        true, 4
      )
      ON CONFLICT (user_id) DO UPDATE SET
        gender = ${gender},
        age = ${age},
        height = ${height},
        current_weight = ${currentWeight},
        target_weight = ${targetWeight},
        goal_deadline = ${goalDeadline},
        weekly_weight_loss_goal = ${weeklyWeightLossGoal},
        daily_calorie_target = ${dailyCalorieTarget},
        daily_water_goal = ${dailyWaterGoal},
        activity_level = ${activityLevel},
        workout_days_per_week = ${workoutDaysPerWeek},
        rest_days = ${JSON.stringify(restDays)},
        cheat_day = ${cheatDay},
        preferred_workout_time = ${preferredWorkoutTime},
        protein_target = ${proteinTarget},
        carbs_target = ${carbsTarget},
        fat_target = ${fatTarget},
        onboarding_completed = true,
        updated_at = NOW()
      RETURNING *
    `;

    res.json(profile[0]);
  } catch (error) {
    console.log("Onboarding error:", error.message);
    res.status(500).json({ error: "Failed to save profile" });
  }
});

// Get User Profile
app.get("/api/profile", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const profile = await sql`
      SELECT * FROM user_profiles WHERE user_id = ${userId}
    `;

    if (profile.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }

    res.json(profile[0]);
  } catch (error) {
    console.log("Get profile error:", error.message);
    res.status(500).json({ error: "Failed to get profile" });
  }
});

// ================================
// HEALTH CHECK
// ================================

app.get("/", (req, res) => {
  res.json({
    status: "Fitness App API Running",
    version: "2.0.0",
    environment: process.env.NODE_ENV || "development",
    features: {
      exercises: "300+ in database",
      food_search: "Indian DB + 3 APIs",
      calorie_calc: "MET-based (no external API)",
      videos: "Auto-fetch from YouTube"
    },
    endpoints: {
      food: "/api/food/search?q=banana",
      exercises: "/api/exercises?bodyPart=chest",
      dashboard: "/api/dashboard?userId=xxx",
      profile: "/api/profile?userId=xxx"
    }
  });
});

// ================================
// START SERVER
// ================================

app.listen(PORT, () => {
  console.log("================================");
  console.log("Fitness App Backend Running");
  console.log("Port:", PORT);
  console.log("Environment:", process.env.NODE_ENV || "development");
  console.log("================================");
});

// Export for Vercel serverless
module.exports = app;
