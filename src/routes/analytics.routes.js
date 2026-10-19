const express = require('express');
const controller = require('../controllers/analytics.controller');

const router = express.Router();

router.get('/dashboard/:userId', controller.getDashboard);
router.get('/stats/:userId', controller.getStats);

module.exports = router;
