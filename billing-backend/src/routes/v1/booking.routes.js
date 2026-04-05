const express = require('express');
const bookingController = require('../../controllers/booking.controller');
const { protect, restrictTo } = require('../../middleware/auth.middleware');

const router = express.Router();

// Protect all routes
router.use(protect);

router.get('/collections', bookingController.getCollections);
router.get('/collections/:id', bookingController.getCollectionDetail);
router.post('/collections', restrictTo('super_admin'), bookingController.createCollection);
router.put('/collections/:id', restrictTo('super_admin'), bookingController.updateCollection);
router.delete('/collections/:id', restrictTo('super_admin'), bookingController.deleteCollection);

module.exports = router;
