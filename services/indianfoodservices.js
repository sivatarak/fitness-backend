const sql = require("../api/db");
const logger = require("../utils/logger");

class IndianFoodsService {
  async searchFoods(query) {
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
      logger.error(`Indian foods search failed: ${error.message}`);
      return [];
    }
  }
}

module.exports = new IndianFoodsService();