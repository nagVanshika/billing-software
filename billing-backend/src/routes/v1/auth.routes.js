const express = require('express');
const authController = require('../../controllers/auth.controller');

const { protect } = require('../../middleware/auth.middleware');

const router = express.Router();

router.post('/login', authController.login);
router.post('/seed', authController.seedAdmins); // Should be disabled in production
router.get('/system-token', protect, authController.getSystemToken);

module.exports = router;
