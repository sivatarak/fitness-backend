const axios = require("axios");
const config = require("../config");
const logger = require("../utils/logger");

class USDAService {
  async searchFoods(query) {
    try {
      const response = await axios.get(
        `https://api.nal.usda.gov/fdc/v1/foods/search`,
        {
          params: {
            api_key: config.usda.apiKey,
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
    } catch (error) {
      logger.error("USDA search failed");
      return [];
    }
  }
}

module.exports = new USDAService();