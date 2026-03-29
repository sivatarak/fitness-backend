const axios = require("axios");
const logger = require("../utils/logger");

class OpenFoodFactsService {
  async searchFoods(query) {
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
    } catch (error) {
      logger.error("OpenFoodFacts search failed");
      return [];
    }
  }
}

module.exports = new OpenFoodFactsService();