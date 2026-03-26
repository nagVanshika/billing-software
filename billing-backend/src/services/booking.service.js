const axios = require('axios');
const jwt = require('jsonwebtoken');
const Collection = require('../models/Collection');
const Category = require('../models/Category');

// Simple in-memory cache
let externalBookingsCache = {
  data: [],
  totalItems: 0,
  timestamp: 0
};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const COMPLETED_STATUSES = ['complete', 'completed', 'feedback done', 'Complete', 'Completed', 'Feedback Done'];

/**
 * Helper to get a system token for external API calls
 */
const getSystemToken = () => {
  return jwt.sign(
    { type: 'system', name: 'BillingBackend' },
    process.env.EXTERNAL_API_SECRET || process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: '1h' }
  );
};

/**
 * Helper to fetch data from the external booking API.
 * Supports fetching multiple pages if needed for stats.
 */
const fetchExternalBookings = async (params = {}) => {
  const now = Date.now();
  
  // Use cache if available and not expired (only for full stats fetch)
  if (params.allPages && (now - externalBookingsCache.timestamp < CACHE_DURATION)) {
    return externalBookingsCache.data;
  }

  try {
    const token = getSystemToken();
    const url = process.env.BOOKING_API_URL || 'https://app.carmaacarcare.com/api/admin/v1/get-bookings';
    
    if (!params.status) {
      params.status = COMPLETED_STATUSES.join(',');
    }

    const fetchPage = async (pageNum) => {
      const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        params: { ...params, page: pageNum, limit: 100 },
        timeout: 15000 // Increased timeout
      });
      return resp.data?.result || {};
    };

    const firstResult = await fetchPage(params.page || 1);
    let bookings = firstResult.bookings || [];

    if (params.allPages && firstResult.totalPages > 1) {
      const promises = [];
      for (let p = 2; p <= firstResult.totalPages; p++) {
        promises.push(fetchPage(p));
      }
      const results = await Promise.all(promises);
      results.forEach(r => {
        if (r.bookings) bookings = bookings.concat(r.bookings);
      });
      
      // Update cache
      externalBookingsCache = {
        data: bookings,
        totalItems: firstResult.totalItems,
        timestamp: Date.now()
      };
    }

    return bookings;
  } catch (error) {
    console.error('External API fetch failed:', error.message);
    // Return stale cache on failure if available
    if (params.allPages && externalBookingsCache.data.length > 0) {
      return externalBookingsCache.data;
    }
    return [];
  }
};

/**
 * Helper to get date range based on period
 */
const getDateRange = (period, dateFrom, dateTo) => {
  if (period === 'custom' && (dateFrom || dateTo)) {
    const filter = {};
    if (dateFrom) filter.$gte = dateFrom;
    if (dateTo) filter.$lte = dateTo;
    return filter;
  }

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  switch (period) {
    case 'today':
      return { $gte: today };
    case 'weekly': {
      const weekAgo = new Date();
      weekAgo.setDate(now.getDate() - 7);
      return { $gte: weekAgo.toISOString().split('T')[0] };
    }
    case 'monthly': {
      const monthAgo = new Date();
      monthAgo.setDate(now.getDate() - 30);
      return { $gte: monthAgo.toISOString().split('T')[0] };
    }
    case 'total':
    default:
      return null;
  }
};

/**
 * Get total collection from bookings with specific statuses
 */
const getCollectionStats = async (period = 'total', dateFrom, dateTo, providedExtBookings = null) => {
  const statuses = COMPLETED_STATUSES;
  const dateFilter = getDateRange(period, dateFrom, dateTo);
  
  // Local Collections
  const cMatch = { status: { $in: statuses } };
  if (dateFilter) cMatch.date = dateFilter;

  const [cStats] = await Collection.aggregate([
    { $match: cMatch },
    { $group: { _id: null, total: { $sum: { $convert: { input: "$amount", to: "double", onError: 0, onNull: 0 } } } } }
  ]);

  // Use provided bookings or fetch (cached)
  const extBookings = providedExtBookings || await fetchExternalBookings({ allPages: true, order: 'desc' });
  
  const from = dateFrom || (dateFilter?.$gte);
  const to = dateTo || (dateFilter?.$lte);

  const filteredExt = extBookings.filter(b => {
    const isStatusMatch = statuses.includes(b.status);
    let isDateMatch = true;
    if (from && b.date < from) isDateMatch = false;
    if (to && b.date > to) isDateMatch = false;
    return isStatusMatch && isDateMatch;
  });

  const extTotal = filteredExt.reduce((sum, b) => sum + parseFloat(b.payment?.price || 0), 0);
  const extCount = filteredExt.length;

  const currentTotal = (cStats?.total || 0) + extTotal;
  
  // Previous Period
  let previousTotal = 0;
  let prevDateFrom, prevDateTo;

  if (period === 'today') {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    prevDateFrom = prevDateTo = yesterday.toISOString().split('T')[0];
  } else if (period === 'weekly') {
    const start = new Date(); start.setDate(start.getDate() - 14);
    const end = new Date(); end.setDate(end.getDate() - 7);
    prevDateFrom = start.toISOString().split('T')[0];
    prevDateTo = end.toISOString().split('T')[0];
  } else if (period === 'monthly') {
    const start = new Date(); start.setDate(start.getDate() - 60);
    const end = new Date(); end.setDate(end.getDate() - 30);
    prevDateFrom = start.toISOString().split('T')[0];
    prevDateTo = end.toISOString().split('T')[0];
  }

  if (prevDateFrom) {
    const prevMatch = { status: { $in: statuses }, date: prevDateFrom === prevDateTo ? prevDateFrom : { $gte: prevDateFrom, $lte: prevDateTo } };
    const [prevC] = await Collection.aggregate([
      { $match: prevMatch },
      { $group: { _id: null, total: { $sum: { $convert: { input: "$amount", to: "double", onError: 0, onNull: 0 } } } } }
    ]);
    const prevExtTotal = extBookings
      .filter(b => {
        const isStatusMatch = statuses.includes(b.status);
        let isDateMatch = true;
        if (prevDateFrom && b.date < prevDateFrom) isDateMatch = false;
        if (prevDateTo && b.date > prevDateTo) isDateMatch = false;
        return isStatusMatch && isDateMatch;
      })
      .reduce((sum, b) => sum + parseFloat(b.payment?.price || 0), 0);
    previousTotal = (prevC?.total || 0) + prevExtTotal;
  }

  return {
    totalCollection: currentTotal,
    previousTotalCollection: previousTotal,
    count: extCount 
  };
};

/**
 * Get revenue trend data
 */
const getRevenueTrend = async (period = 'total', dateFrom, dateTo, providedExtBookings = null) => {
  const statuses = COMPLETED_STATUSES;
  const dateFilter = getDateRange(period, dateFrom, dateTo);
  
  // Optimized: Use daily grouping for smaller ranges, monthly for large ones
  const isDaily = ['today', 'weekly', 'monthly'].includes(period);

  // Local Collections
  const cMatch = { status: { $in: statuses } };
  if (dateFilter) cMatch.date = dateFilter;

  const cTrend = await Collection.aggregate([
    { $match: cMatch },
    {
      $group: {
        _id: isDaily ? "$date" : { $substr: ["$date", 0, 7] }, // YYYY-MM-DD or YYYY-MM
        revenue: { $sum: "$amount" }
      }
    }
  ]);

  const extBookings = providedExtBookings || await fetchExternalBookings({ allPages: true, order: 'desc' });
  const from = dateFrom || (dateFilter?.$gte);
  const to = dateTo || (dateFilter?.$lte);

  const trendMap = {};

  cTrend.forEach(item => {
    trendMap[item._id] = (trendMap[item._id] || 0) + item.revenue;
  });

  extBookings
    .filter(b => {
      const isStatusMatch = statuses.includes(b.status);
      let isDateMatch = true;
      if (from && b.date < from) isDateMatch = false;
      if (to && b.date > to) isDateMatch = false;
      return isStatusMatch && isDateMatch;
    })
    .forEach(b => {
      const key = isDaily ? b.date : b.date.substring(0, 7);
      const val = parseFloat(b.payment?.price || 0);
      trendMap[key] = (trendMap[key] || 0) + val;
    });

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return Object.keys(trendMap)
    .sort()
    .map(key => {
      if (isDaily) {
        const [y, m, d] = key.split('-');
        return {
          month: `${monthNames[parseInt(m) - 1]} ${d}`, // Use 'month' label for frontend compatibility
          revenue: trendMap[key],
          rawDate: key
        };
      } else {
        const [year, month] = key.split('-');
        return {
          month: `${monthNames[parseInt(month) - 1]} ${year}`,
          revenue: trendMap[key],
          rawDate: key
        };
      }
    });
};

/**
 * Get revenue grouped by region
 */
const getRegionWiseRevenue = async (period = 'total', dateFrom, dateTo, providedExtBookings = null) => {
  const statuses = COMPLETED_STATUSES;
  const dateFilter = getDateRange(period, dateFrom, dateTo);
  
  const cMatch = { status: { $in: statuses } };
  if (dateFilter) cMatch.date = dateFilter;

  const cStats = await Collection.aggregate([
    { $match: cMatch },
    { $group: { _id: "$region", value: { $sum: "$amount" } } }
  ]);

  const extBookings = providedExtBookings || await fetchExternalBookings({ allPages: true, order: 'desc' });
  const regions = {};
  
  const from = dateFrom || (dateFilter?.$gte);
  const to = dateTo || (dateFilter?.$lte);

  cStats.forEach(item => {
    const name = item._id || 'Other';
    regions[name] = (regions[name] || 0) + item.value;
  });

  extBookings
    .filter(b => {
      const isStatusMatch = statuses.includes(b.status);
      let isDateMatch = true;
      if (from && b.date < from) isDateMatch = false;
      if (to && b.date > to) isDateMatch = false;
      return isStatusMatch && isDateMatch;
    })
    .forEach(b => {
      const name = b.address?.region || 'Other';
      const val = parseFloat(b.payment?.price || 0);
      regions[name] = (regions[name] || 0) + val;
    });

  return Object.keys(regions).map(name => ({
    name,
    value: regions[name]
  })).sort((a, b) => b.value - a.value);
};

/**
 * Get list of bookings for the collections table with optional filters
 */
const getBookingsList = async (page = 1, limit = 10, filters = {}) => {
  const statuses = COMPLETED_STATUSES;
  const bookingsCat = await Category.findOne({ name: 'Bookings' });

  const cQuery = { status: { $in: statuses } };
  if (filters.dateFrom || filters.dateTo) {
    cQuery.date = {};
    if (filters.dateFrom) cQuery.date.$gte = filters.dateFrom;
    if (filters.dateTo) cQuery.date.$lte = filters.dateTo;
  }
  if (filters.region) cQuery.region = filters.region;
  if (filters.category && bookingsCat && filters.category === bookingsCat._id.toString()) {
    cQuery._id = null; // Exclude collections if searching for system bookings
  }

  const skip = (page - 1) * limit;

  const [collections, total] = await Promise.all([
    Collection.find(cQuery)
      .populate('category', 'name')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Collection.countDocuments(cQuery)
  ]);

  const mappedLocal = collections.map(c => ({
    ...c,
    amount: c.amount,
    payment: { price: c.amount.toString() },
    category: c.category || { name: 'Manual' },
    source: 'collection'
  }));

  return {
    bookings: mappedLocal,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  };
};

/**
 * Get available filters
 */
const getCollectionFilters = async () => {
  const { City } = require('../models/city');
  const regions = await City.distinct('region');

  let bookingsCat = await Category.findOne({ name: 'Bookings' });
  if (!bookingsCat) {
    bookingsCat = await Category.create({ 
      name: 'Bookings', 
      type: 'collection',
      status: 'active',
      description: 'Default category for system bookings'
    });
  }

  const categories = await Category.find({ 
    status: 'active', 
    type: { $in: ['collection', 'both'] } 
  }).select('name').sort({ name: 1 }).lean();

  return { regions, categories };
};

/**
 * Create a manual booking entry
 */
const createBooking = async (bookingData) => {
  const collection = new Collection({
    customerName: bookingData.customerName,
    date: bookingData.date,
    amount: parseFloat(bookingData.payment?.price || 0),
    category: bookingData.category,
    region: bookingData.address?.region || 'Unknown',
    status: bookingData.status || 'complete',
    booking_type: 'manual'
  });
  return await collection.save();
};

module.exports = {
  getCollectionStats,
  getBookingsList,
  getRevenueTrend,
  getRegionWiseRevenue,
  getCollectionFilters,
  createBooking,
  fetchExternalBookings
};
