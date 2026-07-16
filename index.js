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
        scope: "premier" // Changed from "basic" to "premier"
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

    console.log("✅ FatSecret token refreshed");
    return accessToken;
  } catch (error) {
    console.log("❌ FatSecret token error:", error.message);
    if (error.response) {
      console.log("Response:", error.response.data);
    }
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
    // normalize user query
    const q = query.trim().toLowerCase();

    const results = await sql`
      SELECT 
        name, 
        name_regional,
        calories, protein, carbs, fat,
        sugar, fiber, sodium, calcium, iron, vitamin_c, folate,
        serving_size, serving_size_grams,
        category, is_vegetarian,
        'indian_db' as source
      FROM indian_foods
      WHERE 
        LOWER(name) LIKE LOWER(${q + '%'})
        OR LOWER(name_regional) LIKE LOWER(${q + '%'})
        OR LOWER(search_keywords) ~* ('\\m' || ${q} || '\\M')
      ORDER BY 
        CASE 
          WHEN LOWER(name) = LOWER(${q}) THEN 1
          WHEN LOWER(name) LIKE LOWER(${q + '%'}) THEN 2
          WHEN LOWER(name_regional) LIKE LOWER(${q + '%'}) THEN 3
          WHEN LOWER(search_keywords) ~* ('\\m' || ${q} || '\\M') THEN 4
          ELSE 5
        END
      LIMIT 10
    `;

    return results.map(r => ({
      name: r.name,
      name_regional: r.name_regional,
      calories: Number(r.calories) || 0,
      protein: Number(r.protein) || 0,
      carbs: Number(r.carbs) || 0,
      fat: Number(r.fat) || 0,
      sugar: Number(r.sugar) || 0,
      fiber: Number(r.fiber) || 0,
      sodium: Number(r.sodium) || 0,
      calcium: Number(r.calcium) || 0,
      iron: Number(r.iron) || 0,
      vitamin_c: Number(r.vitamin_c) || 0,
      folate: Number(r.folate) || 0,
      serving_size: r.serving_size || '100g',
      serving_size_grams: r.serving_size_grams || 100,
      category: r.category,
      is_vegetarian: r.is_vegetarian,
      source: 'indian_db'
    }));

  } catch (error) {
    console.log("Indian foods search failed:", error.message);
    return [];
  }
}

// ================================
// STREAK HELPERS
// ================================

// 🔥 Workout (with rest days)
// ================================
// STREAK HELPERS
// ================================

// 🏋️ Workout (respects rest days)
function calculateWorkoutStreak(workoutDates, schedule) {
  if (!workoutDates.length) return 0;

  const completed = new Set(workoutDates);
  let streak = 0;
  let current = new Date();

  while (true) {
    const dayName = current.toLocaleDateString("en-US", { weekday: "short" });
    const dateStr = current.toISOString().split("T")[0];

    if (schedule.includes(dayName)) {
      if (completed.has(dateStr)) {
        streak++;
      } else {
        break;
      }
    }

    current.setDate(current.getDate() - 1);
  }

  return streak;
}

// 💧🍽️ Strict streak (daily required)

// ================================
// MAIN FOOD SEARCH ROUTE
// ================================
// ============================================
// CLEANED BACKEND API ROUTES - NO DUPLICATES
// ============================================

// ================================
// 1. FOOD SEARCH (Combined all sources)
// ================================
// ================================
// MAIN FOOD SEARCH ROUTE - IMPROVED
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

    // Search ALL sources in parallel
    const [
      indianResults,
      fatsecretResults,
      usdaResults,
      offResults
    ] = await Promise.all([
      searchIndianFoods(query),
      searchFatSecret(query),
      searchUSDA(query),
      searchOpenFoodFacts(query)
    ]);

    // Process and refine results
    let results = [];

    // Helper to add results with proper source tagging
    const addResults = (items, source) => {
      items.forEach(item => {
        // Filter out items with zero calories (invalid data)
        if (item.calories > 0) {
          results.push({
            ...item,
            source: source,
            // Add display name with source indicator
            display_name: item.name + ` (${source})`
          });
        }
      });
    };

    // Add results from all sources
    addResults(indianResults, 'indian_db');
    addResults(fatsecretResults, 'fatsecret');
    addResults(usdaResults, 'usda');
    addResults(offResults, 'openfoodfacts');

    // Remove duplicates based on name similarity
    const uniqueResults = [];
    const seenNames = new Map();

    for (const item of results) {
      const normalizedName = item.name.toLowerCase().trim();

      // If we haven't seen this food, add it
      if (!seenNames.has(normalizedName)) {
        seenNames.set(normalizedName, item);
        uniqueResults.push(item);
      } else {
        // If we've seen it, keep the one with better source priority
        const existingItem = seenNames.get(normalizedName);
        const sourcePriority = {
          'indian_db': 1,
          'fatsecret': 2,
          'usda': 3,
          'openfoodfacts': 4
        };

        if (sourcePriority[item.source] < sourcePriority[existingItem.source]) {
          // Replace with higher priority source
          const index = uniqueResults.indexOf(existingItem);
          uniqueResults[index] = item;
          seenNames.set(normalizedName, item);
        }
      }
    }

    // Sort by relevance (exact matches first)
    uniqueResults.sort((a, b) => {
      const aExact = a.name.toLowerCase() === query.toLowerCase() ? 0 : 1;
      const bExact = b.name.toLowerCase() === query.toLowerCase() ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;

      // Then by source priority
      const sourcePriority = { 'indian_db': 1, 'fatsecret': 2, 'usda': 3, 'openfoodfacts': 4 };
      return sourcePriority[a.source] - sourcePriority[b.source];
    });

    res.json(uniqueResults.slice(0, 20));

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

    console.log("Food log request:", req.body); // ← ADD THIS to see what's coming in

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

    // ← Separate try/catch so it never breaks food logging
    try {
      await sql`
        INSERT INTO search_intelligence (
          original_query, selected_result_name, calories, protein, carbs, fat, food_source
        ) VALUES (
          ${foodName.toLowerCase()}, ${foodName}, ${calories}, ${protein || 0}, ${carbs || 0}, ${fat || 0}, ${foodSource || 'manual'}
        )
        ON CONFLICT (original_query) DO UPDATE
        SET times_selected = search_intelligence.times_selected + 1, last_searched_at = NOW()
      `;
    } catch (intelligenceError) {
      console.log("search_intelligence insert failed (non-critical):", intelligenceError.message);
    }

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
    COALESCE(SUM(calories), 0) as total_calories,
    COALESCE(SUM(protein), 0) as total_protein,
    COALESCE(SUM(carbs), 0) as total_carbs,
    COALESCE(SUM(fat), 0) as total_fat
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
// ================================
// 4. EXERCISES ENDPOINT
// ================================
app.get("/api/exercises", async (req, res) => {
  try {
    const { bodyPart, equipment, difficulty, exercise_type, limit = 100 } = req.query;

    let exercises;

    if (bodyPart && equipment && difficulty && exercise_type) {
      exercises = await sql`
        SELECT id, name, body_part, target_muscle, equipment, difficulty, exercise_type,
               instructions, secondary_muscles, met_value, youtube_video_id, video_title, video_duration_seconds
        FROM exercises
        WHERE body_part = ${bodyPart} AND equipment = ${equipment}
          AND difficulty = ${difficulty} AND exercise_type = ${exercise_type}
        ORDER BY body_part, name LIMIT ${parseInt(limit)}
      `;
    } else if (bodyPart && equipment && difficulty) {
      exercises = await sql`
        SELECT id, name, body_part, target_muscle, equipment, difficulty, exercise_type,
               instructions, secondary_muscles, met_value, youtube_video_id, video_title, video_duration_seconds
        FROM exercises
        WHERE body_part = ${bodyPart} AND equipment = ${equipment} AND difficulty = ${difficulty}
        ORDER BY body_part, name LIMIT ${parseInt(limit)}
      `;
    } else if (bodyPart && equipment) {
      exercises = await sql`
        SELECT id, name, body_part, target_muscle, equipment, difficulty, exercise_type,
               instructions, secondary_muscles, met_value, youtube_video_id, video_title, video_duration_seconds
        FROM exercises
        WHERE body_part = ${bodyPart} AND equipment = ${equipment}
        ORDER BY body_part, name LIMIT ${parseInt(limit)}
      `;
    } else if (bodyPart && difficulty) {
      exercises = await sql`
        SELECT id, name, body_part, target_muscle, equipment, difficulty, exercise_type,
               instructions, secondary_muscles, met_value, youtube_video_id, video_title, video_duration_seconds
        FROM exercises
        WHERE body_part = ${bodyPart} AND difficulty = ${difficulty}
        ORDER BY body_part, name LIMIT ${parseInt(limit)}
      `;
    } else if (bodyPart) {
      exercises = await sql`
        SELECT id, name, body_part, target_muscle, equipment, difficulty, exercise_type,
               instructions, secondary_muscles, met_value, youtube_video_id, video_title, video_duration_seconds
        FROM exercises
        WHERE body_part = ${bodyPart}
        ORDER BY body_part, name LIMIT ${parseInt(limit)}
      `;
    } else {
      exercises = await sql`
        SELECT id, name, body_part, target_muscle, equipment, difficulty, exercise_type,
               instructions, secondary_muscles, met_value, youtube_video_id, video_title, video_duration_seconds
        FROM exercises
        ORDER BY body_part, name LIMIT ${parseInt(limit)}
      `;
    }

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
    if (exercise.length === 0)
      return res.status(404).json({ error: "Exercise not found" });

    let ex = exercise[0];

    if (!ex.youtube_video_id && process.env.YOUTUBE_API_KEY) {
      try {
        const searchQuery = `${ex.name} proper form tutorial`;
        const youtubeResponse = await axios.get(
          "https://www.googleapis.com/youtube/v3/search",
          {
            params: {
              key: process.env.YOUTUBE_API_KEY,
              q: searchQuery,
              part: "snippet",
              type: "video",
              maxResults: 1,
            },
          }
        );

        if (youtubeResponse.data.items.length > 0) {
          const videoId = youtubeResponse.data.items[0].id.videoId;
          const videoTitle = youtubeResponse.data.items[0].snippet.title;

          await sql`
            UPDATE exercises
            SET youtube_video_id = ${videoId}, video_title = ${videoTitle},
                video_fetched_at = NOW(), updated_at = NOW()
            WHERE id = ${id}
          `;

          ex.youtube_video_id = videoId;
          ex.video_title = videoTitle;
        }
      } catch (ytError) {
        console.log("YouTube search failed:", ytError.message);
      }
    }

    await sql`
      UPDATE exercises
      SET video_view_count = COALESCE(video_view_count, 0) + 1
      WHERE id = ${id}
    `;

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
    const { userId, exerciseId, exerciseName, sets, durationMinutes, notes, caloriesBurned } = req.body;

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
        duration_minutes, total_volume, total_reps, notes, calories_burned, completed_at
      ) VALUES (
        ${userId}, ${exerciseId}, ${exerciseName}, ${JSON.stringify(sets)},
        ${durationMinutes || 0}, ${totalVolume}, ${totalReps}, ${notes || ''}, ${caloriesBurned || 0}, NOW()
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

    // base query
    let workouts;

    if (days) {
      workouts = await sql`
        SELECT * FROM workouts
        WHERE user_id = ${userId}
        AND completed_at >= NOW() - (${days} * INTERVAL '1 day')
        ORDER BY completed_at DESC
        LIMIT ${Number(limit)}
      `;
    } else {
      workouts = await sql`
        SELECT * FROM workouts
        WHERE user_id = ${userId}
        ORDER BY completed_at DESC
        LIMIT ${Number(limit)}
      `;
    }

    res.json(workouts);
  } catch (error) {
    console.log("Get workouts error:", error.message);
    res.status(500).json({ error: "Failed to get workouts" });
  }
});

// ================================
// CALORIES BURNED - USING EXERCISE MET VALUE ONLY
// ================================
app.get("/api/calories-burned", async (req, res) => {
  try {
    const { exerciseId, weight, duration } = req.query;

    // Validate required parameters
    if (!exerciseId || !weight || !duration) {
      return res.status(400).json({
        error: "exerciseId, weight, and duration are required"
      });
    }

    // Get exercise from database
    const exercise = await sql`
      SELECT name, met_value 
      FROM exercises 
      WHERE id = ${exerciseId}
    `;

    // If exercise not found, return 404
    if (exercise.length === 0) {
      return res.status(404).json({
        error: `Exercise with id ${exerciseId} not found`
      });
    }

    const met = parseFloat(exercise[0].met_value);
    const weightKg = parseFloat(weight);
    const durationHours = parseFloat(duration) / 60;

    // Validate numeric values
    if (isNaN(met) || isNaN(weightKg) || isNaN(durationHours)) {
      return res.status(400).json({
        error: "Invalid numeric values for met, weight, or duration"
      });
    }

    const caloriesBurned = Math.round(met * weightKg * durationHours);

    res.json({
      exercise_name: exercise[0].name,
      met_value: met,
      weight_kg: weightKg,
      duration_minutes: parseFloat(duration),
      calories_burned: caloriesBurned
    });

  } catch (error) {
    console.error("Calories calculation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// ================================
// 8. WATER TRACKING
// ================================
app.post("/api/water", async (req, res) => {
  try {
    const { userId, amountMl } = req.body;

    if (!userId || !amountMl) {
      return res.status(400).json({ error: "userId and amountMl required" });
    }

    // ========================================
    // STEP 1 — Archive old logs first
    // ========================================
    const oldLogs = await sql`
      SELECT date, SUM(amount_ml) as total
      FROM water_logs
      WHERE user_id = ${userId}
      AND date < CURRENT_DATE
      GROUP BY date
    `;

    if (oldLogs.length > 0) {
      // Get user's current goal
      const profile = await sql`
        SELECT water_goal FROM user_profiles
        WHERE user_id = ${userId}
      `;
      const goal = profile[0]?.water_goal || 2500;

      // Save each old day to water_daily
      for (const log of oldLogs) {
        await sql`
          INSERT INTO water_daily (user_id, date, total_ml, goal)
          VALUES (${userId}, ${log.date}, ${Number(log.total)}, ${goal})
          ON CONFLICT (user_id, date)
          DO UPDATE SET total_ml = EXCLUDED.total_ml
        `;
      }

      // Delete archived logs from water_logs
      await sql`
        DELETE FROM water_logs
        WHERE user_id = ${userId}
        AND date < CURRENT_DATE
      `;

      console.log(`✅ Archived ${oldLogs.length} days for user ${userId}`);
    }

    // ========================================
    // STEP 2 — Insert new log
    // ========================================
    const result = await sql`
      INSERT INTO water_logs (user_id, amount_ml, logged_at, date)
      VALUES (${userId}, ${amountMl}, NOW(), CURRENT_DATE)
      RETURNING *
    `;

    res.json(result[0]);
  } catch (error) {
    console.log("Log water error:", error.message);
    res.status(500).json({ error: "Failed to log water" });
  }
});


app.delete("/api/food/log/:logId", async (req, res) => {
  try {
    const { logId } = req.params;

    const result = await sql`
      DELETE FROM food_logs 
      WHERE id = ${logId}
      RETURNING *
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: "Food log not found" });
    }

    res.json({ success: true, deleted: result[0] });
  } catch (error) {
    console.log("Delete food log error:", error.message);
    res.status(500).json({ error: "Failed to delete food log" });
  }
});

// DELETE all logs for today
app.delete("/api/water/reset/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    await sql`
      DELETE FROM water_logs
      WHERE user_id = ${userId}
      AND DATE(logged_at) = CURRENT_DATE
    `;

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to reset water" });
  }
});



// ================================
// 9. GET TODAY'S WATER
// ================================
app.get("/api/water/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // ========================================
    // STEP 1 — Archive old logs first
    // (same as POST, runs on every GET too)
    // ========================================
    const oldLogs = await sql`
      SELECT date, SUM(amount_ml) as total
      FROM water_logs
      WHERE user_id = ${userId}
      AND date < CURRENT_DATE
      GROUP BY date
    `;

    if (oldLogs.length > 0) {
      const profile = await sql`
        SELECT water_goal FROM user_profiles
        WHERE user_id = ${userId}
      `;
      const goal = profile[0]?.water_goal || 2500;

      for (const log of oldLogs) {
        await sql`
          INSERT INTO water_daily (user_id, date, total_ml, goal)
          VALUES (${userId}, ${log.date}, ${Number(log.total)}, ${goal})
          ON CONFLICT (user_id, date)
          DO UPDATE SET total_ml = EXCLUDED.total_ml
        `;
      }

      await sql`
        DELETE FROM water_logs
        WHERE user_id = ${userId}
        AND date < CURRENT_DATE
      `;

      console.log(`✅ Archived ${oldLogs.length} days for user ${userId}`);
    }

    // ========================================
    // STEP 2 — Get today's logs
    // ========================================
    const todayLogs = await sql`
      SELECT id, amount_ml, logged_at, date
      FROM water_logs
      WHERE user_id = ${userId}
      AND date = CURRENT_DATE
      ORDER BY logged_at DESC
    `;

    // ========================================
    // STEP 3 — Get today's total
    // ========================================
    const totalResult = await sql`
      SELECT COALESCE(SUM(amount_ml), 0) as total_ml
      FROM water_logs
      WHERE user_id = ${userId}
      AND date = CURRENT_DATE
    `;

    // ========================================
    // STEP 4 — Get goal from user_profiles
    // ========================================
    const profileResult = await sql`
      SELECT water_goal FROM user_profiles
      WHERE user_id = ${userId}
    `;
    const goal = profileResult[0]?.water_goal || 2500;

    // ========================================
    // STEP 5 — Build response
    // ========================================
    res.json({
      total_ml: Number(totalResult[0].total_ml),
      goal: goal,
      logs: todayLogs.map(log => ({
        id: log.id,
        amount_ml: log.amount_ml,
        logged_at: log.logged_at,
        date: log.date,
      }))
    });

  } catch (error) {
    console.log("Get water error:", error.message);
    res.status(500).json({ error: "Failed to get water intake" });
  }
});

// DELETE specific log by id
app.delete("/api/water/delete", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // ========================================
    // STEP 1 — Find most recent log today
    // ========================================
    const recentLog = await sql`
      SELECT id, amount_ml FROM water_logs
      WHERE user_id = ${userId}
      AND date = CURRENT_DATE
      ORDER BY logged_at DESC
      LIMIT 1
    `;

    // ========================================
    // STEP 2 — Check if log exists
    // ========================================
    if (recentLog.length === 0) {
      return res.status(404).json({ error: "No log found for today" });
    }

    // ========================================
    // STEP 3 — Delete that exact row by id
    // ========================================
    const deleted = await sql`
      DELETE FROM water_logs
      WHERE id = ${recentLog[0].id}
      AND user_id = ${userId}
      RETURNING *
    `;

    console.log(`✅ Deleted log id=${recentLog[0].id} amount=${recentLog[0].amount_ml}ml for user ${userId}`);

    res.json({
      success: true,
      deleted: {
        id: deleted[0].id,
        amount_ml: deleted[0].amount_ml,
        logged_at: deleted[0].logged_at,
      }
    });

  } catch (error) {
    console.log("Delete water error:", error.message);
    res.status(500).json({ error: "Failed to delete log" });
  }
});
// DELETE all logs for today
app.delete("/api/water/reset/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // ========================================
    // STEP 1 — Check if any logs exist today
    // ========================================
    const todayLogs = await sql`
      SELECT COUNT(*) as count
      FROM water_logs
      WHERE user_id = ${userId}
      AND date = CURRENT_DATE
    `;

    if (Number(todayLogs[0].count) === 0) {
      return res.json({
        success: true,
        message: "No logs to reset",
        deleted_count: 0
      });
    }

    // ========================================
    // STEP 2 — Delete all today's logs
    // ========================================
    const deleted = await sql`
      DELETE FROM water_logs
      WHERE user_id = ${userId}
      AND date = CURRENT_DATE
      RETURNING *
    `;

    // ========================================
    // STEP 3 — Also remove today from water_daily
    // if it was already archived
    // ========================================
    await sql`
      DELETE FROM water_daily
      WHERE user_id = ${userId}
      AND date = CURRENT_DATE
    `;

    console.log(`✅ Reset ${deleted.length} logs for user ${userId}`);

    res.json({
      success: true,
      message: "Today's water reset successfully",
      deleted_count: deleted.length
    });

  } catch (error) {
    console.log("Reset water error:", error.message);
    res.status(500).json({ error: "Failed to reset water" });
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
      UPDATE user_profiles SET weight  = ${weight}, updated_at = NOW()
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
// ================================
// 12. USER PROFILE - COMPLETE FIXED VERSION
// ================================
// ================================
// 12. USER PROFILE - COMPLETE FIXED VERSION WITH TIMELINE
// ================================
// ================================
// USER PROFILE API - FULLY FIXED
// ================================
app.post("/api/profile", async (req, res) => {
  try {
    const {
      userId, name, age, weight, height, gender,
      targetWeight, timeline, activityLevel, workoutDays,
      dailyCalorieGoal, basic_completed, goals_completed, workout_completed
    } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // Check if user exists in users table (create if not)
    const userExists = await sql`SELECT id FROM users WHERE id = ${userId}`;
    if (userExists.length === 0) {
      await sql`
        INSERT INTO users (id, email, name, created_at)
        VALUES (${userId}, ${userId} || '@betofit.com', ${name || 'User'}, NOW())
      `;
    }

    // Get existing profile
    const existingProfile = await sql`
      SELECT * FROM user_profiles WHERE user_id = ${userId}
    `;

    // Prepare data with existing values or defaults
    let finalName = name;
    let finalAge = age ? parseInt(age) : null;
    let finalWeight = weight ? parseFloat(weight) : null;
    let finalHeight = height ? parseFloat(height) : null;
    let finalGender = gender;
    let finalTargetWeight = targetWeight ? parseFloat(targetWeight) : null;
    let finalTimeline = timeline ? parseInt(timeline) : null;
    let finalActivityLevel = activityLevel;
    let finalWorkoutDays = Array.isArray(workoutDays) ? workoutDays : [];
    let finalDailyCalorieGoal = dailyCalorieGoal ? Math.round(dailyCalorieGoal) : null;

    // If profile exists, use existing values for missing fields
    if (existingProfile.length > 0) {
      const existing = existingProfile[0];
      if (finalName === undefined) finalName = existing.name;
      if (finalAge === null) finalAge = existing.age;
      if (finalWeight === null) finalWeight = existing.weight;
      if (finalHeight === null) finalHeight = existing.height;
      if (finalGender === undefined) finalGender = existing.gender;
      if (finalTargetWeight === null) finalTargetWeight = existing.target_weight;
      if (finalTimeline === null) finalTimeline = existing.timeline;
      if (finalActivityLevel === undefined) finalActivityLevel = existing.activity_level;
      if (finalWorkoutDays.length === 0 && existing.workout_days) {
        try {
          finalWorkoutDays = JSON.parse(existing.workout_days);
        } catch (e) {
          finalWorkoutDays = [];
        }
      }
      if (finalDailyCalorieGoal === null) finalDailyCalorieGoal = existing.daily_calorie_goal;
    }

    // Initialize calculated values
    let bmrRounded = null;
    let tdee = null;
    let waterGoal = null;
    let weeklyWeightLoss = null;
    let dailyGoal = finalDailyCalorieGoal;

    // Calculate BMR and TDEE if we have all required data
    if (finalWeight && finalHeight && finalAge && finalGender) {
      let bmr;
      if (finalGender === 'male') {
        bmr = (10 * finalWeight) + (6.25 * finalHeight) - (5 * finalAge) + 5;
      } else {
        bmr = (10 * finalWeight) + (6.25 * finalHeight) - (5 * finalAge) - 161;
      }
      bmrRounded = Math.round(bmr);

      const activityMultipliers = {
        'sedentary': 1.2,
        'light': 1.375,
        'moderate': 1.55,
        'active': 1.725,
        'very_active': 1.9
      };
      const multiplier = activityMultipliers[finalActivityLevel] || 1.55;
      tdee = Math.round(bmrRounded * multiplier);

      // Water goal
      waterGoal = Math.round(finalWeight * 33);

      // Daily calorie goal if not provided
      if (!finalDailyCalorieGoal && finalTargetWeight && finalTimeline && finalTargetWeight > 0 && finalTimeline > 0) {
        const weightDiff = Math.abs(finalWeight - finalTargetWeight);
        weeklyWeightLoss = weightDiff / finalTimeline;
        const dailyDeficit = Math.round((weeklyWeightLoss * 7700) / 7);
        const isLosingWeight = finalWeight > finalTargetWeight;
        dailyGoal = isLosingWeight ? tdee - dailyDeficit : tdee + dailyDeficit;
      } else if (!finalDailyCalorieGoal) {
        dailyGoal = tdee;
      }
    }

    const workoutDaysJson = JSON.stringify(finalWorkoutDays);

    console.log("Saving profile with values:", {
      userId,
      name: finalName,
      age: finalAge,
      weight: finalWeight,
      height: finalHeight,
      gender: finalGender,
      targetWeight: finalTargetWeight,
      timeline: finalTimeline,
      activityLevel: finalActivityLevel,
      bmr: bmrRounded,
      tdee: tdee,
      dailyGoal: dailyGoal,
      waterGoal: waterGoal,
      workoutDays: finalWorkoutDays
    });

    // ✅ UPDATED: Now saving ALL calculated values
    const profile = await sql`
      INSERT INTO user_profiles (
        user_id, name, age, weight, height, gender,
        target_weight, timeline, activity_level, workout_days,
        daily_calorie_goal, bmr, tdee, water_goal,
        basic_completed, goals_completed, workout_completed,
        profile_complete, created_at, updated_at
      ) VALUES (
        ${userId}, ${finalName}, ${finalAge}, ${finalWeight}, ${finalHeight}, ${finalGender},
        ${finalTargetWeight}, ${finalTimeline}, ${finalActivityLevel}, ${workoutDaysJson},
        ${dailyGoal}, ${bmrRounded}, ${tdee}, ${waterGoal},
        ${basic_completed || false}, ${goals_completed || false}, ${workout_completed || false},
        ${(basic_completed && goals_completed && workout_completed) || false},
        NOW(), NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        name = EXCLUDED.name,
        age = EXCLUDED.age,
        weight = EXCLUDED.weight,
        height = EXCLUDED.height,
        gender = EXCLUDED.gender,
        target_weight = EXCLUDED.target_weight,
        timeline = EXCLUDED.timeline,
        activity_level = EXCLUDED.activity_level,
        workout_days = EXCLUDED.workout_days,
        daily_calorie_goal = EXCLUDED.daily_calorie_goal,
        bmr = EXCLUDED.bmr,
        tdee = EXCLUDED.tdee,
        water_goal = EXCLUDED.water_goal,
        basic_completed = EXCLUDED.basic_completed,
        goals_completed = EXCLUDED.goals_completed,
        workout_completed = EXCLUDED.workout_completed,
        profile_complete = EXCLUDED.basic_completed AND EXCLUDED.goals_completed AND EXCLUDED.workout_completed,
        updated_at = NOW()
      RETURNING *
    `;

    res.status(201).json(profile[0]);

  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ error: "Failed to save profile: " + error.message });
  }
});

// ================================
// 13. GET USER PROFILE
// ================================
app.get("/api/profile/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const profiles = await sql`
      SELECT * FROM user_profiles 
      WHERE user_id = ${userId}
    `;

    if (profiles.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // Parse workout_days back to array if it's stored as JSON
    const profile = profiles[0];
    if (profile.workout_days && typeof profile.workout_days === 'string') {
      try {
        profile.workout_days = JSON.parse(profile.workout_days);
      } catch (e) {
        profile.workout_days = [];
      }
    }

    res.json(profile);

  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ error: "Failed to get profile" });
  }
});
// ================================
// 14. DASHBOARD (SINGLE ROUTE)
// ================================
// 14. DASHBOARD - ENHANCED FOR SMART HOME
// ================================
app.get("/api/dashboard/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Get profile
    const profile = await sql`SELECT * FROM user_profiles WHERE user_id = ${userId}`;
    if (profile.length === 0) return res.status(404).json({ error: "Profile not found" });

    const profileData = profile[0];

    // Parse workout_days from JSON string
    let workoutDays = [];
    if (profileData.workout_days) {
      try {
        workoutDays = typeof profileData.workout_days === 'string'
          ? JSON.parse(profileData.workout_days)
          : profileData.workout_days;
      } catch (e) {
        workoutDays = [];
      }
    }

    // Get today's info
    const today = new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayName = dayNames[today.getDay()];
    const isWorkoutDay = workoutDays.includes(todayName);

    // Check if user is new (< 7 days)
    const createdDate = new Date(profileData.created_at);
    const daysSinceSignup = Math.floor((today - createdDate) / (1000 * 60 * 60 * 24));
    const isNewUser = daysSinceSignup < 7;

    // Get today's food - ROUND the values
    const food = await sql`
      SELECT 
        ROUND(COALESCE(SUM(calories * quantity), 0)) as calories,
        ROUND(COALESCE(SUM(protein * quantity), 0)) as protein,
        ROUND(COALESCE(SUM(carbs * quantity), 0)) as carbs,
        ROUND(COALESCE(SUM(fat * quantity), 0)) as fat
      FROM food_logs
      WHERE user_id = ${userId} AND DATE(logged_at) = CURRENT_DATE
    `;

    // Get today's workouts - ROUND the values
    const workout = await sql`
      SELECT 
        COUNT(*) as count,
        ROUND(COALESCE(SUM(duration_minutes), 0)) as duration,
        ROUND(COALESCE(SUM(calories_burned), 0)) as calories_burned,
        ROUND(COALESCE(SUM(total_volume), 0)) as total_volume
      FROM workouts
      WHERE user_id = ${userId} AND DATE(completed_at) = CURRENT_DATE
    `;

    // Get today's water - ROUND the values
    const water = await sql`
      SELECT ROUND(COALESCE(SUM(amount_ml), 0)) as total_ml
      FROM water_logs
      WHERE user_id = ${userId} AND DATE(logged_at) = CURRENT_DATE
    `;

    // Get last week same day workout (for personalization)
    const lastWeekSameDay = await sql`
      SELECT 
        exercise_name,
        duration_minutes,
        calories_burned,
        sets,
        DATE(completed_at) as workout_date
      FROM workouts
      WHERE user_id = ${userId} 
        AND DATE(completed_at) = CURRENT_DATE - INTERVAL '7 days'
      ORDER BY completed_at DESC
    `;

    // Group exercises from last week
    const lastWeekExercises = lastWeekSameDay.map(w => ({
      name: w.exercise_name,
      duration: w.duration_minutes,
      calories_burned: w.calories_burned,
      sets: w.sets
    }));

    const lastWeekTotalDuration = lastWeekSameDay.reduce((sum, w) => sum + (w.duration_minutes || 0), 0);
    const lastWeekTotalCalories = lastWeekSameDay.reduce((sum, w) => sum + (w.calories_burned || 0), 0);

    // Get weekly data for charts - ROUND the values
    const weekly = await sql`
      SELECT 
        DATE(logged_at) as date,
        ROUND(COALESCE(SUM(calories * quantity), 0)) as calories
      FROM food_logs
      WHERE user_id = ${userId} AND logged_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(logged_at)
      ORDER BY date
    `;

    res.json({
      user: {
        user_id: profileData.user_id,
        name: profileData.name,
        created_at: profileData.created_at,
        days_since_signup: daysSinceSignup,
        is_new_user: isNewUser,
        daily_calorie_goal: profileData.daily_calorie_goal,
        water_goal: profileData.water_goal,
        workout_days: workoutDays,
        target_weight: profileData.target_weight,
        current_weight: profileData.weight
      },
      today: {
        date: today.toISOString().split('T')[0],
        day_name: todayName,
        is_workout_day: isWorkoutDay,
        food: {
          calories: Number(food[0].calories),
          protein: Number(food[0].protein),
          carbs: Number(food[0].carbs),
          fat: Number(food[0].fat)
        },
        workout: {
          completed: Number(workout[0].count) > 0,
          count: Number(workout[0].count),
          duration: Number(workout[0].duration),
          calories_burned: Number(workout[0].calories_burned),
          total_volume: Number(workout[0].total_volume)
        },
        water: {
          total_ml: Number(water[0].total_ml),
          goal: profileData.water_goal
        }
      },
      last_week_same_day: lastWeekSameDay.length > 0 ? {
        date: lastWeekSameDay[0].workout_date,
        total_duration: lastWeekTotalDuration,
        total_calories_burned: lastWeekTotalCalories,
        exercises: lastWeekExercises
      } : null,
      weekly
    });
  } catch (error) {
    console.log("Dashboard error:", error.message);
    res.status(500).json({ error: "Failed to get dashboard data" });
  }
});
// ================================
// STATS ENDPOINT - COMPLETE REAL DATA

// ================================
// STREAK HELPERS
// ================================

// 🏋️ Workout (respects rest days)
function calculateWorkoutStreak(workoutDates, schedule) {
  if (!workoutDates.length) return 0;

  const completed = new Set(workoutDates);
  let streak = 0;
  let current = new Date();

  while (true) {
    const dayName = current.toLocaleDateString("en-US", { weekday: "short" });
    const dateStr = current.toISOString().split("T")[0];

    if (schedule.includes(dayName)) {
      if (completed.has(dateStr)) {
        streak++;
      } else {
        break;
      }
    }

    current.setDate(current.getDate() - 1);
  }

  return streak;
}

// 💧🍽️ Strict streak (daily required)
function calculateStrictStreak(dates) {
  if (!dates.length) return 0;

  const set = new Set(dates);
  let streak = 0;
  let current = new Date();

  while (true) {
    const dateStr = current.toISOString().split("T")[0];

    if (set.has(dateStr)) {
      streak++;
      current.setDate(current.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

// ================================
// STATS API
// ================================
app.get("/api/stats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { period = "week" } = req.query;

    console.log(`📊 Getting stats for user: ${userId}, period: ${period}`);

    let daysAgo = 7;
    if (period === "month") daysAgo = 30;
    if (period === "year") daysAgo = 365;

    // ================================
    // PROFILE
    // ================================
    const profile = await sql`
      SELECT * FROM user_profiles WHERE user_id = ${userId}
    `;

    if (!profile.length) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const profileData = profile[0];

    // ================================
    // WEIGHT PROGRESS
    // ================================
    const firstWeight = await sql`
      SELECT weight FROM weight_history
      WHERE user_id = ${userId}
      ORDER BY id ASC
      LIMIT 1
    `;

    const startWeight = firstWeight[0]?.weight
      ? Number(firstWeight[0].weight)
      : Number(profileData.weight);

    const currentWeight = Number(profileData.weight);
    const targetWeight = Number(profileData.target_weight);

    const weightLost = startWeight - currentWeight;
    const totalToLose = startWeight - targetWeight;

    const progressPercent = totalToLose > 0 ? (weightLost / totalToLose) * 100 : 0;
    const remainingWeight = currentWeight - targetWeight;
    const weeksToGoal = remainingWeight > 0 ? Math.ceil(remainingWeight / 0.5) : 0;

    // ================================
    // FOOD
    // ================================
    const foodData = await sql`
      SELECT date::text, SUM(calories * quantity) as total
      FROM food_logs
      WHERE user_id = ${userId}
      AND date >= CURRENT_DATE - (${daysAgo} * INTERVAL '1 day')
      GROUP BY date
    `;

    // ================================
    // WORKOUT
    // ================================
    const workoutData = await sql`
      SELECT DATE(completed_at)::text as date, SUM(duration_minutes) as total
      FROM workouts
      WHERE user_id = ${userId}
      AND completed_at >= NOW() - (${daysAgo} * INTERVAL '1 day')
      GROUP BY DATE(completed_at)
    `;

    // ================================
    // WATER — all queries together ✅
    // ================================
    const waterLogsData = await sql`
      SELECT date::text, SUM(amount_ml) as total
      FROM water_logs
      WHERE user_id = ${userId}
      AND date >= CURRENT_DATE - (${daysAgo} * INTERVAL '1 day')
      GROUP BY date
    `;

    const waterDailyData = await sql`
      SELECT date::text, total_ml as total
      FROM water_daily
      WHERE user_id = ${userId}
      AND date >= CURRENT_DATE - (${daysAgo} * INTERVAL '1 day')
    `;

    // ================================
    // STREAK DATES
    // ================================
    const workoutDates = await sql`
      SELECT DISTINCT DATE(completed_at)::text as date
      FROM workouts
      WHERE user_id = ${userId}
    `;

    const waterDates = await sql`
      SELECT DISTINCT date::text as date FROM water_daily WHERE user_id = ${userId}
      UNION
      SELECT DISTINCT date::text as date FROM water_logs  WHERE user_id = ${userId}
    `;

    const foodDates = await sql`
      SELECT DISTINCT date::text as date
      FROM food_logs
      WHERE user_id = ${userId}
    `;

    // ================================
    // TOP EXERCISES
    // ================================
    const topExercises = await sql`
      SELECT exercise_name, COUNT(*) as total_sets
      FROM workouts
      WHERE user_id = ${userId}
      AND completed_at >= NOW() - (${daysAgo} * INTERVAL '1 day')
      GROUP BY exercise_name
      ORDER BY total_sets DESC
      LIMIT 5
    `;

    // ================================
    // TOTAL WORKOUT STATS
    // ================================
    const totalStats = await sql`
      SELECT
        COALESCE(SUM(duration_minutes), 0) as total_minutes,
        COALESCE(SUM(calories_burned),  0) as total_calories
      FROM workouts
      WHERE user_id = ${userId}
      AND completed_at >= NOW() - (${daysAgo} * INTERVAL '1 day')
    `;

    // ================================
    // BUILD MAPS
    // ================================
    const foodMap = Object.fromEntries(
      foodData.map(d => [d.date, Number(d.total)])
    );

    const workoutMap = Object.fromEntries(
      workoutData.map(d => [d.date, Number(d.total)])
    );

    // water_daily takes priority; water_logs fills in missing dates
    const waterFromLogs = Object.fromEntries(waterLogsData.map(d => [d.date, Number(d.total)]));
    const waterFromDaily = Object.fromEntries(waterDailyData.map(d => [d.date, Number(d.total)]));
    const waterMap = { ...waterFromLogs, ...waterFromDaily }; // daily overwrites logs if both exist

    // ================================
    // BUILD CHART ARRAYS
    // ================================
    const weeklyCalories = [];
    const weeklyWorkouts = [];
    const weeklyWater = [];
    const labels = [];

    for (let i = daysAgo - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

      labels.push(dayNames[d.getDay()]);
      weeklyCalories.push(foodMap[dateStr] || 0);
      weeklyWorkouts.push(workoutMap[dateStr] || 0);
      weeklyWater.push(Number(((waterMap[dateStr] || 0) / 1000).toFixed(1)));
    }

    // ================================
    // QUICK STATS
    // ================================
    const workoutDaysCount = weeklyWorkouts.filter(v => v > 0).length;
    const restDays = daysAgo - workoutDaysCount;
    const totalCaloriesBurned = weeklyWorkouts.reduce((sum, mins) => sum + mins * 6, 0);
    const totalWater = Number(weeklyWater.reduce((a, b) => a + b, 0).toFixed(1));

    // ================================
    // STREAKS
    // ================================
    const schedule = profileData.workout_schedule || ["Mon", "Tue", "Wed", "Thu", "Fri"];

    const workoutStreak = calculateWorkoutStreak(
      workoutDates.map(d => d.date),
      schedule
    );

    const waterStreak = calculateStrictStreak(waterDates.map(d => d.date));
    const foodStreak = calculateStrictStreak(foodDates.map(d => d.date));

    // ================================
    // RESPONSE
    // ================================
    res.json({
      period,
      weight_progress: {
        start_weight: Number(startWeight.toFixed(1)),
        current_weight: currentWeight,
        target_weight: targetWeight,
        weight_lost: Number(weightLost.toFixed(1)),
        progress_percent: Math.min(Math.round(progressPercent), 100),
        weeks_to_goal: weeksToGoal,
      },
      weekly_charts: {
        calories: weeklyCalories,
        workouts: weeklyWorkouts,
        water: weeklyWater,
        labels,
      },
      quick_stats: {
        workout_days: workoutDaysCount,
        rest_days: restDays,
        total_calories_burned: Math.round(totalCaloriesBurned),
        total_water_liters: totalWater,
      },
      streaks: {
        workout_streak: workoutStreak,
        water_streak: waterStreak,
        food_log_streak: foodStreak,
      },
      top_exercises: topExercises.map(e => ({
        name: e.exercise_name,
        sets: Number(e.total_sets),
      })),
      total_stats: {
        total_active_minutes: Number(totalStats[0]?.total_minutes || 0),
        total_calories_burned: Number(totalStats[0]?.total_calories || 0),
      },
    });

  } catch (error) {
    console.error("❌ Stats API error:", error);
    res.status(500).json({
      error: "Failed to get stats data",
      details: error.message,
    });
  }
});


//history api's

// ================================
// HISTORY APIs (Add these to your backend)
// ================================

// Get workout history by date range
app.get("/api/history/workouts/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { days = 7, date } = req.query;

    let query;
    if (date) {
      // Get workouts for specific date
      query = sql`
        SELECT * FROM workouts
        WHERE user_id = ${userId}
          AND DATE(completed_at) = ${date}
        ORDER BY completed_at DESC
      `;
    } else {
      // Get workouts for last X days
      query = sql`
        SELECT * FROM workouts
        WHERE user_id = ${userId}
          AND completed_at >= NOW() - (${days} * INTERVAL '1 day')
        ORDER BY completed_at DESC
      `;
    }

    const workouts = await query;
    res.json(workouts);
  } catch (error) {
    console.log("Get workout history error:", error.message);
    res.status(500).json({ error: "Failed to get workout history" });
  }
});

// Get food history by date range
app.get("/api/history/food/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { days = 7, date } = req.query;

    let query;
    if (date) {
      query = sql`
        SELECT * FROM food_logs
        WHERE user_id = ${userId}
          AND DATE(logged_at) = ${date}
        ORDER BY logged_at DESC
      `;
    } else {
      query = sql`
        SELECT * FROM food_logs
        WHERE user_id = ${userId}
          AND logged_at >= NOW() - (${days} * INTERVAL '1 day')
        ORDER BY logged_at DESC
      `;
    }

    const foodLogs = await query;
    res.json(foodLogs);
  } catch (error) {
    console.log("Get food history error:", error.message);
    res.status(500).json({ error: "Failed to get food history" });
  }
});

// Get water history by date range
app.get("/api/history/water/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { days = 7, date } = req.query;

    let query;
    if (date) {
      query = sql`
        SELECT * FROM water_logs
        WHERE user_id = ${userId}
          AND DATE(logged_at) = ${date}
        ORDER BY logged_at DESC
      `;
    } else {
      query = sql`
        SELECT * FROM water_logs
        WHERE user_id = ${userId}
          AND logged_at >= NOW() - (${days} * INTERVAL '1 day')
        ORDER BY logged_at DESC
      `;
    }

    const waterLogs = await query;
    res.json(waterLogs);
  } catch (error) {
    console.log("Get water history error:", error.message);
    res.status(500).json({ error: "Failed to get water history" });
  }
});

// Get weight history
app.get("/api/history/weight/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { days = 30 } = req.query;

    const weightHistory = await sql`
      SELECT * FROM weight_history
      WHERE user_id = ${userId}
        AND logged_at >= NOW() - (${days} * INTERVAL '1 day')
      ORDER BY logged_at ASC
    `;

    res.json(weightHistory);
  } catch (error) {
    console.log("Get weight history error:", error.message);
    res.status(500).json({ error: "Failed to get weight history" });
  }
});

// Post weight
app.post("/api/history/weight", async (req, res) => {
  try {
    const { userId, weight, notes } = req.body;

    if (!userId || !weight) {
      return res.status(400).json({ error: "userId and weight required" });
    }

    const result = await sql`
      INSERT INTO weight_history (user_id, weight, notes, logged_at)
      VALUES (${userId}, ${weight}, ${notes || ''}, NOW())
      RETURNING *
    `;

    // Update user profile current weight
    await sql`
      UPDATE user_profiles 
      SET weight = ${weight}, updated_at = NOW()
      WHERE user_id = ${userId}
    `;

    res.json(result[0]);
  } catch (error) {
    console.log("Log weight error:", error.message);
    res.status(500).json({ error: "Failed to log weight" });
  }
});

// Get weekly summary
app.get("/api/history/weekly/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const weeklyData = await sql`
      SELECT 
        DATE_TRUNC('week', completed_at) as week_start,
        SUM(calories_burned) as total_calories,
        SUM(duration_minutes) as total_minutes,
        COUNT(*) as workout_count
      FROM workouts
      WHERE user_id = ${userId}
        AND completed_at >= NOW() - INTERVAL '4 weeks'
      GROUP BY DATE_TRUNC('week', completed_at)
      ORDER BY week_start DESC
    `;

    res.json(weeklyData);
  } catch (error) {
    console.log("Get weekly summary error:", error.message);
    res.status(500).json({ error: "Failed to get weekly summary" });
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


