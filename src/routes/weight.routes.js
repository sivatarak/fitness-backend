const express = require('express');
const controller = require('../controllers/weight.controller');

const router = express.Router();

router.post('/weight', controller.logWeight);
router.get('/weight/:userId', controller.getWeightHistory);

module.exports = router;
