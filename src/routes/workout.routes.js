const express = require('express');
const controller = require('../controllers/workout.controller');

const router = express.Router();

router.post('/workouts', controller.logWorkout);
router.get('/workouts/:userId', controller.getWorkouts);
router.get('/calories-burned', controller.calculateCaloriesBurned);

module.exports = router;
