const expenseService = require('../services/expense.service');
const { sendSlackNotification } = require('../utils/slack');

/**
 * Get expenses with optional filters
 */
const getExpenses = async (req, res, next) => {
// ... (lines 7-36 remain same)
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const filters = {
      category: req.query.category,
      region:   req.query.region,
      status:   req.query.status,
      search:   req.query.search,
      dateFrom: req.query.dateFrom,
      dateTo:   req.query.dateTo,
      period:   req.query.period
    };

    const [data, categories, regions, categoryWiseExpense, expenseTrend] = await Promise.all([
      expenseService.getExpenses(filters, page, limit),
      expenseService.getCategories(),
      expenseService.getRegions(),
      expenseService.getExpenseCategoryStats(req.query.period || 'total', req.query.dateFrom, req.query.dateTo),
      expenseService.getExpenseTrend(req.query.period || 'total', req.query.dateFrom, req.query.dateTo)
    ]);

    res.status(200).json({
      success: true,
      data: {
        ...data,
        categoryWiseExpense,
        expenseTrend,
        filters: {
          categories,
          regions
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new expense
 */
const createExpense = async (req, res, next) => {
  try {
    const expenseData = { ...req.body };
    
    // If file is uploaded, add its S3 location to expenseData
    if (req.file) {
      expenseData.attachment = req.file.location;
    }

    const expense = await expenseService.createExpense(expenseData);
    
    // Populate category to get the name for Slack
    await expense.populate('category', 'name');

    // Send Slack Notification
    sendSlackNotification({
      expense_id: expense._id,
      reason: expense.reason,
      amount: expense.amount,
      categoryName: expense.category?.name,
      paidBy: expense.paidBy,
      channel: process.env.SLACK_CHANNEL || 'carmaa-bills-update',
      type: 'Expense'
    }).catch(err => console.error('Slack notification failed:', err));

    res.status(201).json({
      success: true,
      data: expense
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get expense statistics for charts
 */
const getExpenseStats = async (req, res, next) => {
  try {
    const { period, dateFrom, dateTo } = req.query;
    const categoryStats = await expenseService.getExpenseCategoryStats(period, dateFrom, dateTo);

    res.status(200).json({
      success: true,
      data: {
        categoryStats
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all distinct regions
 */
const getRegions = async (req, res, next) => {
  try {
    const regions = await expenseService.getRegions();
    res.status(200).json({ success: true, data: regions });
  } catch (error) {
    next(error);
  }
};

/**
 * Bulk upload expenses from Excel
 */
const bulkUpload = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an Excel file' });
    }

    const result = await expenseService.bulkUploadExpenses(req.file.buffer);

    // Send Slack Notification for bulk upload
    sendSlackNotification({
      expense_id: 'Multiple',
      reason: `Bulk Upload: ${result.count} expenses`,
      amount: result.totalAmount || 'Check Dashboard',
      channel: process.env.SLACK_CHANNEL || 'carmaa-bills-update',
      type: 'full_message'
    }).catch(err => console.error('Slack notification failed:', err));

    res.status(200).json({
      success: true,
      data: result,
      message: `Successfully imported ${result.count} expenses`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update an existing expense
 */
const updateExpense = async (req, res, next) => {
  try {
    const { id } = req.params;
    const expenseData = { ...req.body };
    
    // If file is uploaded, add its S3 location to expenseData
    if (req.file) {
      expenseData.attachment = req.file.location;
    }

    const updated = await expenseService.updateExpense(id, expenseData);

    res.status(200).json({
      success: true,
      message: 'Expense updated successfully',
      data: updated
    });
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 403) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * Soft delete an expense
 */
const deleteExpense = async (req, res, next) => {
  try {
    const { id } = req.params;
    await expenseService.softDeleteExpense(id);

    res.status(200).json({
      success: true,
      message: 'Expense deleted successfully'
    });
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 403) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

module.exports = {
  getExpenses,
  createExpense,
  getExpenseStats,
  getRegions,
  bulkUpload,
  updateExpense,
  deleteExpense
};
