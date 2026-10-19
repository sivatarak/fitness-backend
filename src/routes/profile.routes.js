const express = require('express');
const controller = require('../controllers/profile.controller');

const router = express.Router();

router.post('/profile', controller.saveProfile);
router.get('/profile/:userId', controller.getProfile);

module.exports = router;
