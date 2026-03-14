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

// ============================================
// CLEANED BACKEND API ROUTES - NO DUPLICATES
// ============================================

// ================================
// 1. FOOD SEARCH (Combined all sources)
// ================================
app.get("/api/food/search", async (req, res) => {
  try {
    let query = req.query.q;
    if (!query) return res.status(400).json({ error: "query required" });

    console.log("User search:", query);

    // Check search intelligence first
    const learned = await sql`
      SELECT * FROM search_intelligence
      WHERE original_query = ${query.toLowerCase()}
      ORDER BY times_selected DESC, confidence_score DESC
      LIMIT 1
    `;

    if (learned.length > 0) {
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

    // Translate query if needed
    query = await translateToEnglish(query);
    console.log("Searching for:", query);

    // Search in order: Indian DB → FatSecret → USDA → OpenFoodFacts
    let results = await searchIndianFoods(query);
    if (results.length === 0) results = await searchFatSecret(query);
    if (results.length === 0) results = await searchUSDA(query);
    if (results.length === 0) results = await searchOpenFoodFacts(query);

    res.json(results);
  } catch (error) {
    console.log("Search error:", error.message);
    res.status(500).json({ error: "Food search failed" });
  }
});

// ================================
// 2. FOOD LOGGING
// ================================
app.post("/api/food/log", async (req, res) => {
  try {
    const { userId, foodName, calories, protein, carbs, fat, mealType, quantity, foodSource } = req.body;

    if (!userId || !foodName || !calories) {
      return res.status(400).json({ error: "userId, foodName, and calories required" });
    }

    const result = await sql`
      INSERT INTO food_logs (
        user_id, food_name, calories, protein, carbs, fat, 
        meal_type, quantity, food_source, logged_at
      ) VALUES (
        ${userId}, ${foodName}, ${calories}, ${protein || 0}, ${carbs || 0}, ${fat || 0},
        ${mealType || 'snack'}, ${quantity || 1}, ${foodSource || 'manual'}, NOW()
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
// 3. GET TODAY'S FOOD LOGS
// ================================
app.get("/api/food/logs/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

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
      WHERE user_id = ${userId} AND DATE(logged_at) = CURRENT_DATE
    `;

    res.json({ logs, totals: totals[0] });
  } catch (error) {
    console.log("Get food logs error:", error.message);
    res.status(500).json({ error: "Failed to get food logs" });
  }
});

// ================================
// 4. EXERCISES ENDPOINT
// ================================
app.get("/api/exercises", async (req, res) => {
  try {
    const { bodyPart, equipment, difficulty, limit = 100 } = req.query;

    let query = sql`SELECT * FROM exercises WHERE 1=1`;

    if (bodyPart) query = sql`${query} AND body_part = ${bodyPart}`;
    if (equipment) query = sql`${query} AND equipment = ${equipment}`;
    if (difficulty) query = sql`${query} AND difficulty = ${difficulty}`;

    query = sql`${query} ORDER BY body_part, name LIMIT ${limit}`;

    const exercises = await query;
    res.json(exercises);
  } catch (error) {
    console.log("Get exercises error:", error.message);
    res.status(500).json({ error: "Failed to get exercises" });
  }
});

// ================================
// 5. SINGLE EXERCISE WITH YOUTUBE
// ================================
app.get("/api/exercises/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const exercise = await sql`SELECT * FROM exercises WHERE id = ${id}`;
    if (exercise.length === 0) return res.status(404).json({ error: "Exercise not found" });

    let ex = exercise[0];

    // Auto-fetch YouTube video if needed
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
              maxResults: 1
            }
          }
        );

        if (youtubeResponse.data.items.length > 0) {
          const videoId = youtubeResponse.data.items[0].id.videoId;
          await sql`
            UPDATE exercises
            SET youtube_video_id = ${videoId}, video_fetched_at = NOW()
            WHERE id = ${id}
          `;
          ex.youtube_video_id = videoId;
        }
      } catch (ytError) {
        console.log("YouTube search failed:", ytError.message);
      }
    }

    // Increment view count
    await sql`UPDATE exercises SET view_count = view_count + 1 WHERE id = ${id}`;

    res.json(ex);
  } catch (error) {
    console.log("Get exercise error:", error.message);
    res.status(500).json({ error: "Failed to get exercise" });
  }
});

// ================================
// 6. LOG WORKOUT
// ================================
app.post("/api/workouts", async (req, res) => {
  try {
    const { userId, exerciseId, exerciseName, sets, durationMinutes, notes } = req.body;

    if (!userId || !exerciseId || !sets) {
      return res.status(400).json({ error: "userId, exerciseId, and sets required" });
    }

    // Calculate totals
    let totalVolume = 0, totalReps = 0;
    sets.forEach(set => {
      totalReps += set.reps || 0;
      totalVolume += (set.reps || 0) * (set.weight || 0);
    });

    const result = await sql`
      INSERT INTO workouts (
        user_id, exercise_id, exercise_name, sets, 
        duration_minutes, total_volume, total_reps, notes, completed_at
      ) VALUES (
        ${userId}, ${exerciseId}, ${exerciseName}, ${JSON.stringify(sets)},
        ${durationMinutes || 0}, ${totalVolume}, ${totalReps}, ${notes || ''}, NOW()
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
// 7. GET WORKOUT HISTORY
// ================================
app.get("/api/workouts/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, days } = req.query;

    let query = sql`SELECT * FROM workouts WHERE user_id = ${userId}`;

    if (days) {
      query = sql`${query} AND completed_at >= NOW() - INTERVAL '${days} days'`;
    }

    query = sql`${query} ORDER BY completed_at DESC LIMIT ${limit}`;

    const workouts = await query;
    res.json(workouts);
  } catch (error) {
    console.log("Get workouts error:", error.message);
    res.status(500).json({ error: "Failed to get workouts" });
  }
});

// ================================
// 8. WATER TRACKING
// ================================
app.post("/api/water", async (req, res) => {
  try {
    const { userId, amountMl } = req.body;
    if (!userId || !amountMl) return res.status(400).json({ error: "userId and amountMl required" });

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
// 9. GET TODAY'S WATER
// ================================
app.get("/api/water/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await sql`
      SELECT COALESCE(SUM(amount_ml), 0) as total_ml
      FROM water_logs
      WHERE user_id = ${userId} AND DATE(logged_at) = CURRENT_DATE
    `;

    res.json({ total_ml: Number(result[0].total_ml) });
  } catch (error) {
    console.log("Get water error:", error.message);
    res.status(500).json({ error: "Failed to get water intake" });
  }
});

// ================================
// 10. WEIGHT TRACKING
// ================================
app.post("/api/weight", async (req, res) => {
  try {
    const { userId, weight, notes } = req.body;
    if (!userId || !weight) return res.status(400).json({ error: "userId and weight required" });

    const result = await sql`
      INSERT INTO weight_history (user_id, weight, notes, logged_at)
      VALUES (${userId}, ${weight}, ${notes || ''}, NOW())
      RETURNING *
    `;

    await sql`
      UPDATE user_profiles SET current_weight = ${weight}, updated_at = NOW()
      WHERE user_id = ${userId}
    `;

    res.json(result[0]);
  } catch (error) {
    console.log("Log weight error:", error.message);
    res.status(500).json({ error: "Failed to log weight" });
  }
});

// ================================
// 11. GET WEIGHT HISTORY
// ================================
app.get("/api/weight/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { days = 30 } = req.query;

    const history = await sql`
      SELECT * FROM weight_history
      WHERE user_id = ${userId} AND logged_at >= NOW() - INTERVAL '${days} days'
      ORDER BY logged_at ASC
    `;

    res.json(history);
  } catch (error) {
    console.log("Get weight history error:", error.message);
    res.status(500).json({ error: "Failed to get weight history" });
  }
});

// ================================
// 12. USER PROFILE (SINGLE ROUTE)
// ================================
app.post("/api/profile", async (req, res) => {
  try {
    const {
      userId, name, age, weight, height, gender,
      targetWeight, activityLevel, workoutDays, dailyCalorieGoal
    } = req.body;

    if (!userId || !name) return res.status(400).json({ error: "userId and name required" });

    // Calculate goals
    const bmr = gender === 'male'
      ? (10 * weight) + (6.25 * height) - (5 * age) + 5
      : (10 * weight) + (6.25 * height) - (5 * age) - 161;

    const activityMultipliers = { 'sedentary': 1.2, 'light': 1.375, 'moderate': 1.55, 'active': 1.725, 'very_active': 1.9 };
    const tdee = Math.round(bmr * (activityMultipliers[activityLevel] || 1.2));

    const waterGoal = Math.round(weight * 33); // ml

    // Upsert profile
    const profile = await sql`
      INSERT INTO user_profiles (
        user_id, name, age, current_weight, height, gender,
        target_weight, activity_level, workout_days, water_goal,
        daily_calorie_goal, bmr, tdee, profile_complete, updated_at
      ) VALUES (
        ${userId}, ${name}, ${age}, ${weight}, ${height}, ${gender},
        ${targetWeight}, ${activityLevel}, ${JSON.stringify(workoutDays || [])}, ${waterGoal},
        ${dailyCalorieGoal || tdee}, ${bmr}, ${tdee}, true, NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        name = ${name}, age = ${age}, current_weight = ${weight},
        height = ${height}, gender = ${gender}, target_weight = ${targetWeight},
        activity_level = ${activityLevel}, workout_days = ${JSON.stringify(workoutDays || [])},
        water_goal = ${waterGoal}, daily_calorie_goal = ${dailyCalorieGoal || tdee},
        bmr = ${bmr}, tdee = ${tdee}, updated_at = NOW()
      RETURNING *
    `;

    res.json(profile[0]);
  } catch (error) {
    console.log("Profile error:", error.message);
    res.status(500).json({ error: "Failed to save profile" });
  }
});

// ================================
// 13. GET USER PROFILE
// ================================
app.get("/api/profile/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const profile = await sql`SELECT * FROM user_profiles WHERE user_id = ${userId}`;
    if (profile.length === 0) return res.status(404).json({ error: "Profile not found" });

    res.json(profile[0]);
  } catch (error) {
    console.log("Get profile error:", error.message);
    res.status(500).json({ error: "Failed to get profile" });
  }
});

// ================================
// 14. DASHBOARD (SINGLE ROUTE)
// ================================
app.get("/api/dashboard/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Get profile
    const profile = await sql`SELECT * FROM user_profiles WHERE user_id = ${userId}`;
    if (profile.length === 0) return res.status(404).json({ error: "Profile not found" });

    // Get today's food
    const food = await sql`
      SELECT 
        COALESCE(SUM(calories * quantity), 0) as calories,
        COALESCE(SUM(protein * quantity), 0) as protein,
        COALESCE(SUM(carbs * quantity), 0) as carbs,
        COALESCE(SUM(fat * quantity), 0) as fat
      FROM food_logs
      WHERE user_id = ${userId} AND DATE(logged_at) = CURRENT_DATE
    `;

    // Get today's workouts
    const workout = await sql`
      SELECT 
        COUNT(*) as count,
        COALESCE(SUM(duration_minutes), 0) as duration,
        COALESCE(SUM(total_volume), 0) as total_volume
      FROM workouts
      WHERE user_id = ${userId} AND DATE(completed_at) = CURRENT_DATE
    `;

    // Get today's water
    const water = await sql`
      SELECT COALESCE(SUM(amount_ml), 0) as total_ml
      FROM water_logs
      WHERE user_id = ${userId} AND DATE(logged_at) = CURRENT_DATE
    `;

    // Get weekly data for charts
    const weekly = await sql`
      SELECT 
        DATE(logged_at) as date,
        COALESCE(SUM(calories * quantity), 0) as calories
      FROM food_logs
      WHERE user_id = ${userId} AND logged_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(logged_at)
      ORDER BY date
    `;

    res.json({
      profile: profile[0],
      today: {
        food: food[0],
        workout: workout[0],
        water: { total_ml: Number(water[0].total_ml), goal: profile[0].water_goal },
        net_calories: Number(food[0].calories)
      },
      weekly: weekly
    });
  } catch (error) {
    console.log("Dashboard error:", error.message);
    res.status(500).json({ error: "Failed to get dashboard data" });
  }
});

// ================================
// 15. HEALTH CHECK
// ================================
app.get("/", (req, res) => {
  res.json({
    status: "Fitness App API Running",
    version: "2.0.0",
    environment: process.env.NODE_ENV || "development",
    endpoints: {
      food: "/api/food/search?q=banana",
      exercises: "/api/exercises?bodyPart=chest",
      dashboard: "/api/dashboard/user123",
      profile: "/api/profile/user123"
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
