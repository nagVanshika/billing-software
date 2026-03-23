const Expense = require('../models/billing-expense');
require('../models/billing-category'); // Ensure Category model is registered

/**
 * Get all expenses with filters and pagination
 */
const getExpenses = async (filters = {}, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  
  const query = {};
  if (filters.category) query.category = filters.category;
  if (filters.region)   query.region   = filters.region;
  if (filters.status)   query.status   = filters.status;
  if (filters.search) {
    query.reason = { $regex: filters.search, $options: 'i' };
  }
  if (filters.dateFrom || filters.dateTo) {
    query.expenseDate = {};
    if (filters.dateFrom) query.expenseDate.$gte = new Date(filters.dateFrom);
    if (filters.dateTo)   query.expenseDate.$lte = new Date(filters.dateTo + 'T23:59:59.999Z');
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
 * Get expense stats grouped by category
 */
const getExpenseCategoryStats = async (period = 'total', dateFrom, dateTo) => {
  const dateFilter = getDateRange(period, dateFrom, dateTo);
  const matchQuery = {};
  
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
  const { City } = require('../models/city');
  return City.distinct('region');
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
  getExpenseCategoryStats,
  bulkUploadExpenses
};
