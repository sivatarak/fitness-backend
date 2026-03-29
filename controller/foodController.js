const translationService = require("../services/translationService");
const fatsecretService = require("../services/fatsecretService");
const usdaService = require("../services/usdaService");
const openFoodFactsService = require("../services/openFoodFactsService");
const indianFoodsService = require("../services/indianFoodsService");
const logger = require("../utils/logger");

class FoodController {
  async searchFoods(req, res) {
    try {
      const { query, translate = "true" } = req.query;
      
      if (!query) {
        return res.status(400).json({ 
          error: "Query parameter is required" 
        });
      }

      let searchQuery = query;
      
      // Translate if needed
      if (translate === "true") {
        searchQuery = await translationService.translateToEnglish(query);
        logger.info(`Translated: "${query}" -> "${searchQuery}"`);
      }

      // Search all sources in parallel
      const [fatsecret, usda, openFoodFacts, indianFoods] = await Promise.all([
        fatsecretService.searchFoods(searchQuery),
        usdaService.searchFoods(searchQuery),
        openFoodFactsService.searchFoods(searchQuery),
        indianFoodsService.searchFoods(searchQuery)
      ]);

      // Combine results
      const allResults = [...fatsecret, ...usda, ...openFoodFacts, ...indianFoods];
      
      // Remove duplicates by name (simple approach)
      const uniqueResults = [];
      const names = new Set();
      for (const item of allResults) {
        if (!names.has(item.name.toLowerCase())) {
          names.add(item.name.toLowerCase());
          uniqueResults.push(item);
        }
      }

      res.json({
        success: true,
        query: {
          original: query,
          translated: searchQuery,
          translated_used: translate === "true"
        },
        results: uniqueResults,
        counts: {
          fatsecret: fatsecret.length,
          usda: usda.length,
          openfoodfacts: openFoodFacts.length,
          indian: indianFoods.length,
          total: uniqueResults.length
        }
      });

    } catch (error) {
      logger.error(`Food search error: ${error.message}`);
      res.status(500).json({ 
        error: "Failed to search foods",
        details: error.message 
      });
    }
  }

  async searchFatSecret(req, res) {
    try {
      const { query, translate = "true" } = req.query;
      
      if (!query) {
        return res.status(400).json({ error: "Query parameter is required" });
      }

      let searchQuery = query;
      if (translate === "true") {
        searchQuery = await translationService.translateToEnglish(query);
      }

      const results = await fatsecretService.searchFoods(searchQuery);
      
      res.json({
        success: true,
        query: { original: query, translated: searchQuery },
        results,
        source: "fatsecret"
      });
    } catch (error) {
      logger.error(`FatSecret search error: ${error.message}`);
      res.status(500).json({ error: "Failed to search FatSecret" });
    }
  }

  async searchUSDA(req, res) {
    try {
      const { query, translate = "true" } = req.query;
      
      if (!query) {
        return res.status(400).json({ error: "Query parameter is required" });
      }

      let searchQuery = query;
      if (translate === "true") {
        searchQuery = await translationService.translateToEnglish(query);
      }

      const results = await usdaService.searchFoods(searchQuery);
      
      res.json({
        success: true,
        query: { original: query, translated: searchQuery },
        results,
        source: "usda"
      });
    } catch (error) {
      logger.error(`USDA search error: ${error.message}`);
      res.status(500).json({ error: "Failed to search USDA" });
    }
  }

  async searchOpenFoodFacts(req, res) {
    try {
      const { query, translate = "true" } = req.query;
      
      if (!query) {
        return res.status(400).json({ error: "Query parameter is required" });
      }

      let searchQuery = query;
      if (translate === "true") {
        searchQuery = await translationService.translateToEnglish(query);
      }

      const results = await openFoodFactsService.searchFoods(searchQuery);
      
      res.json({
        success: true,
        query: { original: query, translated: searchQuery },
        results,
        source: "openfoodfacts"
      });
    } catch (error) {
      logger.error(`OpenFoodFacts search error: ${error.message}`);
      res.status(500).json({ error: "Failed to search OpenFoodFacts" });
    }
  }

  async searchIndianFoods(req, res) {
    try {
      const { query, translate = "true" } = req.query;
      
      if (!query) {
        return res.status(400).json({ error: "Query parameter is required" });
      }

      let searchQuery = query;
      if (translate === "true") {
        searchQuery = await translationService.translateToEnglish(query);
      }

      const results = await indianFoodsService.searchFoods(searchQuery);
      
      res.json({
        success: true,
        query: { original: query, translated: searchQuery },
        results,
        source: "indian_db"
      });
    } catch (error) {
      logger.error(`Indian foods search error: ${error.message}`);
      res.status(500).json({ error: "Failed to search Indian foods database" });
    }
  }
}

module.exports = new FoodController();