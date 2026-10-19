const sql = require('../../api/db');
const { translateToEnglish, searchFatSecret, searchUSDA, searchOpenFoodFacts, searchIndianFoods } = require('../services/food-search.service');

async function searchFood(req, res) {
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

}

async function logFood(req, res) {
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

}

async function getFoodLogs(req, res) {
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

}

async function deleteFoodLog(req, res) {
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

}

module.exports = { searchFood, logFood, getFoodLogs, deleteFoodLog };
