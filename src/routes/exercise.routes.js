const express = require('express');
const controller = require('../controllers/exercise.controller');

const router = express.Router();

router.get('/exercises', controller.listExercises);
router.get('/exercises/:id', controller.getExercise);

module.exports = router;
