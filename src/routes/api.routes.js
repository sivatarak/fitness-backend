const express = require('express');
const router = express.Router();

router.use(require('./food.routes'));
router.use(require('./exercise.routes'));
router.use(require('./workout.routes'));
router.use(require('./water.routes'));
router.use(require('./weight.routes'));
router.use(require('./profile.routes'));
router.use(require('./analytics.routes'));
router.use(require('./history.routes'));

module.exports = router;
