const express = require('express');
const router = express.Router();
const expenseController = require('../../controllers/expense.controller');
const upload = require('../../middleware/upload');
const billUpload = require('../../middleware/billUpload');
const { protect, restrictTo } = require('../../middleware/auth.middleware');

// Protect all routes after this middleware
router.use(protect);

router.get('/regions', expenseController.getRegions);
router.get('/stats', expenseController.getExpenseStats);
router.get('/', expenseController.getExpenses);

// Only super_admin can create/import expenses
router.post('/', restrictTo('super_admin'), billUpload.single('bill'), expenseController.createExpense);
router.post('/import', restrictTo('super_admin'), upload.single('file'), expenseController.bulkUpload);

router.put('/:id', restrictTo('super_admin'), billUpload.single('bill'), expenseController.updateExpense);
router.delete('/:id', restrictTo('super_admin'), expenseController.deleteExpense);

module.exports = router;

