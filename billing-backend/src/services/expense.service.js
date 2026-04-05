const Expense = require('../models/billing-expense');
// Ensure Category model is registered
require('../models/billing-category');

/**
 * Helper to get date range based on period
 */
const getDateRange = (period, dateFrom, dateTo) => {
  if (period === 'custom' && (dateFrom || dateTo)) {
    const filter = {};
    if (dateFrom) filter.$gte = new Date(dateFrom);
    if (dateTo) filter.$lte = new Date(dateTo + 'T23:59:59.999Z');
    return filter;
  }

  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  switch (period) {
    case 'today':
      return { $gte: today };
    case 'weekly': {
      const weekAgo = new Date();
      weekAgo.setDate(now.getDate() - 7);
      return { $gte: weekAgo };
    }
    case 'monthly': {
      const monthAgo = new Date();
      monthAgo.setDate(now.getDate() - 30);
      return { $gte: monthAgo };
    }
    case 'total':
    default:
      return null;
  }
};

/**
 * Get all expenses with filters and pagination
 */
const getExpenses = async (filters = {}, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  
  const query = { isDeleted: { $ne: true } };
  if (filters.category) query.category = filters.category;
  if (filters.region)   query.region   = filters.region;
  if (filters.status)   query.status   = filters.status;
  if (filters.search) {
    query.reason = { $regex: filters.search, $options: 'i' };
  }
  
  const dateFilter = getDateRange(filters.period, filters.dateFrom, filters.dateTo);
  if (dateFilter) {
    query.expenseDate = dateFilter;
  }

  const expenses = await Expense.find(query)
    .populate('category', 'name')
    .sort({ expenseDate: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Expense.countDocuments(query);

  // For summary stats
  const stats = await Expense.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: "$amount" },
        count: { $sum: 1 }
      }
    }
  ]);

  return {
    expenses,
    stats: stats[0] || { totalAmount: 0, count: 0 },
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  };
};

/**
 * Create a new expense
 */
const createExpense = async (expenseData) => {
  const expense = new Expense(expenseData);
  return await expense.save();
};

/**
 * Get all available active categories
 */
const getCategories = async () => {
  const Category = require('../models/billing-category');
  return await Category.find({ 
    status: 'active',
    type: { $in: ['expense', 'both'] }
  }).sort({ name: 1 }).lean();
};

/**
 * Get expense trend for charts
 */
const getExpenseTrend = async (period = 'total', dateFrom, dateTo) => {
  const dateFilter = getDateRange(period, dateFrom, dateTo);
  const matchQuery = { isDeleted: { $ne: true } };
  
  if (dateFilter) matchQuery.expenseDate = dateFilter;

  const isDaily = ['today', 'weekly', 'monthly'].includes(period);

  const stats = await Expense.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: isDaily 
               ? { $dateToString: { format: "%Y-%m-%d", date: "$expenseDate" } }
               : { $dateToString: { format: "%Y-%m", date: "$expenseDate" } },
        expense: { $sum: "$amount" }
      }
    }
  ]);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return stats
    .sort((a, b) => a._id.localeCompare(b._id))
    .map(item => {
      if (isDaily) {
        const [y, m, d] = item._id.split('-');
        return {
          month: `${monthNames[parseInt(m) - 1]} ${d}`,
          expense: item.expense,
          rawDate: item._id
        };
      } else {
        const [year, month] = item._id.split('-');
        return {
          month: `${monthNames[parseInt(month) - 1]} ${year}`,
          expense: item.expense,
          rawDate: item._id
        };
      }
    });
};

/**
 * Get expense stats grouped by category
 */
const getExpenseCategoryStats = async (period = 'total', dateFrom, dateTo) => {
  const dateFilter = getDateRange(period, dateFrom, dateTo);
  const matchQuery = { isDeleted: { $ne: true } };
  
  if (dateFilter) {
    matchQuery.expenseDate = dateFilter;
  }

  const stats = await Expense.aggregate([
    {
      $match: matchQuery
    },
    {
      $group: {
        _id: "$category",
        value: { $sum: "$amount" }
      }
    },
    {
      $lookup: {
        from: "billing-category",
        localField: "_id",
        foreignField: "_id",
        as: "categoryDetails"
      }
    },
    {
      $unwind: "$categoryDetails"
    },
    {
      $project: {
        _id: 0,
        name: "$categoryDetails.name",
        value: 1
      }
    },
    {
      $sort: { value: -1 }
    }
  ]);

  return stats;
};

/**
 * Get all unique regions from City model
 */
const getRegions = async () => {
  const bookingService = require('./booking.service');
  return await bookingService.fetchExternalRegions();
};

/**
 * Update an existing expense
 */
const updateExpense = async (id, updateData) => {
  const expense = await Expense.findById(id);

  if (!expense) {
    const err = new Error('Expense not found');
    err.statusCode = 404;
    throw err;
  }

  // Fields allowed to be updated
  const allowedFields = [
    'category', 'reason', 'expenseDate', 'paymentMode', 
    'paidBy', 'transactionId', 'amount', 'settled', 
    'region', 'notes', 'attachment'
  ];

  allowedFields.forEach(field => {
    if (updateData[field] !== undefined) {
      expense[field] = updateData[field];
    }
  });

  return await expense.save();
};

/**
 * Soft delete an expense
 */
const softDeleteExpense = async (id) => {
  const expense = await Expense.findById(id);

  if (!expense) {
    const err = new Error('Expense not found');
    err.statusCode = 404;
    throw err;
  }

  expense.isDeleted = true;
  expense.deletedAt = new Date();
  
  return await expense.save();
};

const bulkUploadExpenses = async (buffer) => {
  const xlsx = require('xlsx');
  const Category = require('../models/billing-category');
  
  const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  
  let headerIndex = -1;
  const targetHeaders = ['type of expense', 'expense reason', 'payment date', 'payment mode', 'paid by', 'transaction id', 'transection id', 'amount', 'settled'];
  
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i].some(cell => cell && targetHeaders.includes(cell.toString().trim().toLowerCase()))) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error('Could not find header row in the Excel sheet');
  }

  const headers = rows[headerIndex].map(h => (h || '').toString().trim());
  const dataRows = rows.slice(headerIndex + 1);

  const getIdx = (name) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const colMap = {
    category: getIdx('Type Of Expense'),
    reason: getIdx('Expense Reason'),
    date: getIdx('Payment Date'),
    mode: getIdx('Payment Mode'),
    paidBy: getIdx('Paid By'),
    txnId1: getIdx('Transaction ID'),
    txnId2: getIdx('Transection ID'),
    amount: getIdx('Amount'),
    settled: getIdx('Settled'),
    notes: getIdx('Notes'),
    region: getIdx('Region')
  };

  const getActiveCategories = async () => {
    const cats = await Category.find({ 
      status: 'active',
      type: { $in: ['expense', 'both'] }
    }).lean();
    return cats.reduce((map, cat) => {
      map[cat.name.toLowerCase()] = cat._id;
      return map;
    }, {});
  };

  let categoryMap = await getActiveCategories();
  const expensesToInsert = [];
  const errors = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = headerIndex + i + 2; 

    if (!row || row.length === 0) continue;
    const catIdx = colMap.category;
    const amtIdx = colMap.amount;
    if (catIdx !== -1 && !row[catIdx] && amtIdx !== -1 && !row[amtIdx]) continue;

    try {
      const categoryName = catIdx !== -1 ? (row[catIdx] || '').toString().trim() : '';
      let categoryId = categoryName ? categoryMap[categoryName.toLowerCase()] : null;

      // Auto-create category if missing
      if (!categoryId && categoryName) {
        const newCat = await Category.create({ 
          name: categoryName, 
          status: 'active',
          type: 'expense'
        });
        categoryId = newCat._id;
        categoryMap = await getActiveCategories(); // Refresh map
      }

      const rawDate = colMap.date !== -1 ? row[colMap.date] : null;
      let expenseDate = new Date();
      if (rawDate) {
        expenseDate = (rawDate instanceof Date) ? rawDate : new Date(rawDate);
      }

      const settledIdx = colMap.settled;
      const settled = settledIdx !== -1 ? (row[settledIdx] || 'No').toString().trim() : 'No';

      const txnId = (colMap.txnId1 !== -1 ? row[colMap.txnId1] : (colMap.txnId2 !== -1 ? row[colMap.txnId2] : '')) || '';

      expensesToInsert.push({
        category: categoryId,
        reason: (colMap.reason !== -1 ? (row[colMap.reason] || 'Bulk upload') : 'Bulk upload').toString().trim(),
        expenseDate,
        paymentMode: (colMap.mode !== -1 ? (row[colMap.mode] || 'Cash') : 'Cash').toString().trim(),
        paidBy: (colMap.paidBy !== -1 ? (row[colMap.paidBy] || 'Unknown') : 'Unknown').toString().trim(),
        transactionId: txnId.toString().trim(),
        amount: parseFloat((colMap.amount !== -1 ? row[colMap.amount] : 0) || 0),
        settled,
        notes: (colMap.notes !== -1 ? (row[colMap.notes] || '') : '').toString().trim(),
        region: colMap.region !== -1 ? (row[colMap.region] || undefined) : undefined
      });
    } catch (err) {
      errors.push(`Row ${rowNum}: ${err.message}`);
    }
  }

  if (expensesToInsert.length === 0 && errors.length > 0) {
    throw new Error(`Failed to import any expenses. Errors: ${errors.join('; ')}`);
  }

  const result = await Expense.insertMany(expensesToInsert);
  
  return {
    count: result.length,
    errors: errors.length > 0 ? errors : null
  };
};

module.exports = {
  getExpenses,
  createExpense,
  getCategories,
  getRegions,
  getExpenseTrend,
  getExpenseCategoryStats,
  updateExpense,
  softDeleteExpense,
  bulkUploadExpenses
};
