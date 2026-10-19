const express = require('express');
const controller = require('../controllers/water.controller');

const router = express.Router();

router.post('/water', controller.logWater);
router.delete('/water/reset/:userId', controller.resetWater);
router.get('/water/:userId', controller.getWater);
router.delete('/water/delete', controller.deleteWater);

module.exports = router;
