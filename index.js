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
app.post("/api/profile", async (req, res) => {
  try {
    const {
      userId, name, age, weight, height, gender,
      targetWeight, timeline, activityLevel, workoutDays, dailyCalorieGoal
    } = req.body;

    // Only userId is absolutely required
    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // Check if user exists in users table (create if not)
    const userExists = await sql`SELECT id FROM users WHERE id = ${userId}`;
    if (userExists.length === 0) {
      await sql`
        INSERT INTO users (id, email, name, created_at)
        VALUES (${userId}, ${userId} + '@betofit.com', ${name || 'User'}, NOW())
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
        finalWorkoutDays = JSON.parse(existing.workout_days);
      }
      if (finalDailyCalorieGoal === null) finalDailyCalorieGoal = existing.daily_calorie_goal;
    }

    // Validate only if we have the data for calculations
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
        'sedentary': 1.2, 'light': 1.375, 'moderate': 1.55,
        'active': 1.725, 'very_active': 1.9
      };
      const multiplier = activityMultipliers[finalActivityLevel] || 1.55;
      tdee = Math.round(bmrRounded * multiplier);

      // Water goal
      waterGoal = Math.round(finalWeight * 33);

      // Daily calorie goal if not provided
      if (!finalDailyCalorieGoal && finalTargetWeight && finalTimeline) {
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

    // Upsert profile
    const profile = await sql`
      INSERT INTO user_profiles (
        user_id, name, age, weight, height, gender,
        target_weight, timeline, weekly_weight_loss,
        activity_level, workout_days, water_goal,
        daily_calorie_goal, bmr, tdee,
        profile_complete, created_at, updated_at
      ) VALUES (
        ${userId}, ${finalName}, ${finalAge}, ${finalWeight}, ${finalHeight}, ${finalGender},
        ${finalTargetWeight}, ${finalTimeline}, ${weeklyWeightLoss},
        ${finalActivityLevel}, ${workoutDaysJson}, ${waterGoal},
        ${dailyGoal}, ${bmrRounded}, ${tdee},
        true, NOW(), NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        name = EXCLUDED.name,
        age = EXCLUDED.age,
        weight = EXCLUDED.weight,
        height = EXCLUDED.height,
        gender = EXCLUDED.gender,
        target_weight = EXCLUDED.target_weight,
        timeline = EXCLUDED.timeline,
        weekly_weight_loss = EXCLUDED.weekly_weight_loss,
        activity_level = EXCLUDED.activity_level,
        workout_days = EXCLUDED.workout_days,
        water_goal = EXCLUDED.water_goal,
        daily_calorie_goal = EXCLUDED.daily_calorie_goal,
        bmr = EXCLUDED.bmr,
        tdee = EXCLUDED.tdee,
        profile_complete = true,
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
app.get("/api/dashboard/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Get profile
    const profile = await sql`SELECT * FROM user_profiles WHERE user_id = ${userId}`;
    if (profile.length === 0) return res.status(404).json({ error: "Profile not found" });

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
      profile: profile[0],
      today: {
        food: food[0],
        workout: workout[0],
        water: { total_ml: Number(water[0].total_ml), goal: profile[0].water_goal },
        net_calories: Number(food[0].calories)
      },
      weekly
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


