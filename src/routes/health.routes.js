const express = require('express');
const controller = require('../controllers/health.controller');

const router = express.Router();

router.get('/', controller.healthCheck);

module.exports = router;
