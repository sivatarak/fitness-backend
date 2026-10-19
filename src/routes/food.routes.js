const express = require('express');
const controller = require('../controllers/food.controller');

const router = express.Router();

router.get('/food/search', controller.searchFood);
router.post('/food/log', controller.logFood);
router.get('/food/logs/:userId', controller.getFoodLogs);
router.delete('/food/log/:logId', controller.deleteFoodLog);

module.exports = router;
