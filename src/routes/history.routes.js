const express = require('express');
const controller = require('../controllers/history.controller');

const router = express.Router();

router.get('/history/workouts/:userId', controller.getWorkoutHistory);
router.get('/history/food/:userId', controller.getFoodHistory);
router.get('/history/water/:userId', controller.getWaterHistory);
router.get('/history/weight/:userId', controller.getWeightHistory);
router.post('/history/weight', controller.logWeight);
router.get('/history/weekly/:userId', controller.getWeeklySummary);

module.exports = router;
