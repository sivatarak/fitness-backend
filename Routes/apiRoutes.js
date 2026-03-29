const express = require("express");
const router = express.Router();
const foodController = require("../controllers/foodController");
const translationController = require("../controllers/translationController");

// ================================
// Health Check
// ================================
router.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ================================
// Translation Routes
// ================================
router.post("/translate", translationController.translate.bind(translationController));

// ================================
// Food Search Routes
// ================================
// Combined search from all sources
router.get("/search", foodController.searchFoods.bind(foodController));

// Individual source searches
router.get("/search/fatsecret", foodController.searchFatSecret.bind(foodController));
router.get("/search/usda", foodController.searchUSDA.bind(foodController));
router.get("/search/openfoodfacts", foodController.searchOpenFoodFacts.bind(foodController));
router.get("/search/indian", foodController.searchIndianFoods.bind(foodController));

// ================================
// Root API Info
// ================================
router.get("/", (req, res) => {
  res.json({
    name: "Fitness Food Search API",
    version: "1.0.0",
    endpoints: {
      health: "GET /api/health",
      translate: "POST /api/translate",
      search: "GET /api/search?query={food_name}&translate=true",
      search_fatsecret: "GET /api/search/fatsecret?query={food_name}",
      search_usda: "GET /api/search/usda?query={food_name}",
      search_openfoodfacts: "GET /api/search/openfoodfacts?query={food_name}",
      search_indian: "GET /api/search/indian?query={food_name}"
    }
  });
});

module.exports = router;