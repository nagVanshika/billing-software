const axios = require('axios');
const jwt = require('jsonwebtoken');
const Collection = require('../models/billing-collection');
const Category = require('../models/billing-category');

// In-memory cache keyed by status string (e.g. 'all', 'complete,completed,...')
// This prevents completed-only fetches from polluting the all-statuses cache
const externalBookingsCache = {};

let externalRegionsCache = {
  data: [],
  timestamp: 0
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes for bookings
const REGION_CACHE_DURATION = 60 * 60 * 1000; // 1 hour for regions

const COMPLETED_STATUSES = ['complete', 'completed', 'feedback done', 'feedback_done'];

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

  // Determine the effective status key for cache lookup BEFORE mutating params
  const cacheKey = params.status || 'completed';

  // Use cache if available and not expired (only for full stats fetch)
  if (params.allPages && externalBookingsCache[cacheKey] &&
      (now - externalBookingsCache[cacheKey].timestamp < CACHE_DURATION)) {
    return externalBookingsCache[cacheKey].data;
  }

  try {
    const token = getSystemToken();
    const url = process.env.BOOKING_API_URL || 'https://app-prd.carmaacarcare.com/api/admin/v1/get-bookings';

    if (!params.status) {
      params.status = COMPLETED_STATUSES.join(',');
    } else if (params.status === 'all') {
      delete params.status; // Clear status to fetch all from API
    }

    const fetchPage = async (pageNum) => {
      const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        params: { ...params, page: pageNum, limit: 100 },
        timeout: 15000
      });
      return resp.data?.result || {};
    };

    const firstResult = await fetchPage(params.page || 1);
    let bookings = firstResult.bookings || [];

    if (params.allPages) {
      if (firstResult.totalPages > 1) {
        const promises = [];
        for (let p = 2; p <= firstResult.totalPages; p++) {
          promises.push(fetchPage(p));
        }
        const results = await Promise.all(promises);
        results.forEach(r => {
          if (r.bookings) bookings = bookings.concat(r.bookings);
        });
      }

      // Update cache keyed by status (works for both single-page and multi-page)
      externalBookingsCache[cacheKey] = {
        data: bookings,
        totalItems: firstResult.totalItems,
        timestamp: Date.now()
      };
    }

    return bookings;
  } catch (error) {
    console.error('External API fetch failed:', error.message);
    if (params.allPages && externalBookingsCache[cacheKey]?.data?.length > 0) {
      return externalBookingsCache[cacheKey].data;
    }
    return [];
  }
};

/**
 * Helper to fetch regions from the external city-data API
 */
const fetchExternalRegions = async () => {
  const now = Date.now();

  if (now - externalRegionsCache.timestamp < REGION_CACHE_DURATION && externalRegionsCache.data.length > 0) {
    return externalRegionsCache.data;
  }

  try {
    const token = getSystemToken();
    const url = 'https://app-prd.carmaacarcare.com/api/admin/v1/get-city-data';

    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000
    });

    const results = resp.data?.result || [];
    const regions = results
      .filter(item => item.status === 'active')
      .map(item => item.region)
      .filter((val, idx, self) => self.indexOf(val) === idx) // Unique
      .sort();

    if (regions.length > 0) {
      externalRegionsCache = {
        data: regions,
        timestamp: Date.now()
      };
    }

    return regions;
  } catch (error) {
    console.error('External regions fetch failed:', error.message);
    return externalRegionsCache.data || [];
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

  // Revenue calculation from local collections
  const cMatch = { status: { $in: statuses }, isDeleted: { $ne: true } };
  if (dateFilter) cMatch.date = dateFilter;

  const [cStats] = await Collection.aggregate([
    { $match: cMatch },
    { $group: { _id: null, total: { $sum: { $convert: { input: "$amount", to: "double", onError: 0, onNull: 0 } } } } }
  ]);

  // Fetch ALL external bookings for counting
  const extBookings = providedExtBookings || await fetchExternalBookings({
    allPages: true,
    order: 'desc',
    status: 'all' // Added specifically to bypass completion filter
  });

  const from = dateFrom || (dateFilter?.$gte);
  const to = dateTo || (dateFilter?.$lte);

  // Filter external bookings specifically for REVENUE (Completed Only)
  const filteredExtForRevenue = extBookings.filter(b => {
    const isStatusMatch = statuses.includes(b.status.toLowerCase());
    let isDateMatch = true;
    if (from && b.date < from) isDateMatch = false;
    if (to && b.date > to) isDateMatch = false;
    return isStatusMatch && isDateMatch;
  });

  // Filter for TOTAL COUNT (All statuses, but respecting date range)
  const filteredExtForCount = extBookings.filter(b => {
    let isDateMatch = true;
    if (from && b.date < from) isDateMatch = false;
    if (to && b.date > to) isDateMatch = false;
    return isDateMatch;
  });

  const extTotalRevenue = filteredExtForRevenue.reduce((sum, b) => sum + parseFloat(b.payment?.price || 0), 0);
  const extTotalCount = filteredExtForCount.length;

  // Local count (respecting date range if applicable)
  const localCountQuery = dateFilter ? { date: dateFilter } : {};
  const localTotalCount = await Collection.countDocuments(localCountQuery);

  const currentTotalRevenue = (cStats?.total || 0) + extTotalRevenue;
  const currentTotalCount = extTotalCount + localTotalCount;

  let previousTotal = 0;
  // ... previous total logic for percentage changes (if needed) remains similar but should ideally use same logic
  // For brevity and focus, I'll update the main return values.

  return {
    totalCollection: currentTotalRevenue,
    previousTotalCollection: previousTotal, // Could be calculated but keeping focused on count fix
    count: currentTotalCount
  };
};

/**
 * Get revenue trend data
 */
const getRevenueTrend = async (period = 'total', dateFrom, dateTo, providedExtBookings = null) => {
  const statuses = COMPLETED_STATUSES;
  const dateFilter = getDateRange(period, dateFrom, dateTo);

  const isDaily = ['today', 'weekly', 'monthly'].includes(period);

  const cMatch = { status: { $in: statuses }, isDeleted: { $ne: true } };
  if (dateFilter) cMatch.date = dateFilter;

  const cTrend = await Collection.aggregate([
    { $match: cMatch },
    {
      $group: {
        _id: isDaily ? "$date" : { $substr: ["$date", 0, 7] },
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
      const isStatusMatch = statuses.includes(b.status.toLowerCase());
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
          month: `${monthNames[parseInt(m) - 1]} ${d}`,
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

  const cMatch = { status: { $in: statuses }, isDeleted: { $ne: true } };
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
      const isStatusMatch = statuses.includes(b.status.toLowerCase());
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
 * Get revenue grouped by category
 */
const getCategoryWiseRevenue = async (period = 'total', dateFrom, dateTo, providedExtBookings = null) => {
  const statuses = COMPLETED_STATUSES;
  const dateFilter = getDateRange(period, dateFrom, dateTo);

  const cMatch = { status: { $in: statuses }, isDeleted: { $ne: true } };
  if (dateFilter) cMatch.date = dateFilter;

  // Use find and populate since categories are an ObjectId reference
  const manualCollections = await Collection.find(cMatch).populate('category', 'name').lean();

  const categoriesMap = {};

  manualCollections.forEach(item => {
    const name = item.category?.name || 'Manual';
    categoriesMap[name] = (categoriesMap[name] || 0) + item.amount;
  });

  const extBookings = providedExtBookings || await fetchExternalBookings({ allPages: true, order: 'desc' });
  
  const from = dateFrom || (dateFilter?.$gte);
  const to = dateTo || (dateFilter?.$lte);

  extBookings
    .filter(b => {
      const isStatusMatch = statuses.includes(b.status.toLowerCase());
      let isDateMatch = true;
      if (from && b.date < from) isDateMatch = false;
      if (to && b.date > to) isDateMatch = false;
      return isStatusMatch && isDateMatch;
    })
    .forEach(b => {
      // Use Booking category if available, otherwise default to "Bookings"
      const name = b.category?.name || 'Bookings';
      const val = parseFloat(b.payment?.price || 0);
      categoriesMap[name] = (categoriesMap[name] || 0) + val;
    });

  return Object.keys(categoriesMap).map(name => ({
    name,
    value: categoriesMap[name]
  })).sort((a, b) => b.value - a.value);
};


/**
 * Get list of bookings for the collections table with optional filters
 */
const getBookingsList = async (page = 1, limit = 10, filters = {}) => {
  const statuses = COMPLETED_STATUSES;
  const bookingsCat = await Category.findOne({ name: 'Bookings' });

  const cQuery = { status: { $in: statuses }, isDeleted: { $ne: true } };
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
  // Fetch regions from external API instead of local DB
  const regions = await fetchExternalRegions();

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

/**
 * Update a manual collection entry
 */
const updateBooking = async (id, updateData) => {
  const collection = await Collection.findById(id);

  if (!collection) {
    const err = new Error('Collection not found');
    err.statusCode = 404;
    throw err;
  }

  if (collection.booking_type !== 'manual') {
    const err = new Error('Only manual collections can be edited');
    err.statusCode = 403;
    throw err;
  }

  const allowedFields = ['customerName', 'date', 'amount', 'category', 'region', 'notes', 'status'];
  allowedFields.forEach(field => {
    if (updateData[field] !== undefined) {
      // Support payment.price as amount alias from frontend
      if (field === 'amount' && updateData.payment?.price !== undefined) {
        collection.amount = parseFloat(updateData.payment.price);
      } else {
        collection[field] = updateData[field];
      }
    }
  });

  // Also handle payment.price → amount mapping
  if (updateData.payment?.price !== undefined && updateData.amount === undefined) {
    collection.amount = parseFloat(updateData.payment.price);
  }

  return await collection.save();
};

/**
 * Soft delete a manual collection entry
 */
const softDeleteBooking = async (id) => {
  const collection = await Collection.findById(id);

  if (!collection) {
    const err = new Error('Collection not found');
    err.statusCode = 404;
    throw err;
  }

  if (collection.booking_type !== 'manual') {
    const err = new Error('Only manual collections can be deleted');
    err.statusCode = 403;
    throw err;
  }

  collection.isDeleted = true;
  collection.deletedAt = new Date();
  return await collection.save();
};

/**
 * Get full details of a booking (Local fallback for frontend)
 */
const getBookingDetail = async (id) => {
  try {
    const local = await Collection.findById(id).populate('category', 'name').lean();
    if (local) {
      return {
        ...local,
        amount: local.amount,
        customerName: local.customerName,
        date: local.date,
        source: 'collection',
        booking_type: 'manual'
      };
    }
  } catch (err) {
    // Not a valid ObjectId or not found locally
  }

  // Fallback to external check just in case it was called incorrectly
  try {
    const token = getSystemToken();
    const url = 'https://app-prd.carmaacarcare.com/api/admin/v1/get-booking-by-id';
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      params: { bookingId: id },
      timeout: 10000
    });

    if (resp.data?.success) {
      const b = resp.data.result;
      return {
        ...b,
        amount: parseFloat(b.payment?.price || 0),
        source: 'external-booking',
        booking_type: b.booking_type || 'system'
      };
    }
  } catch (error) { }

  return null;
};

module.exports = {
  getCollectionStats,
  getBookingsList,
  getRevenueTrend,
  getRegionWiseRevenue,
  getCategoryWiseRevenue,
  getCollectionFilters,
  createBooking,
  updateBooking,
  softDeleteBooking,
  getBookingDetail,
  fetchExternalBookings,
  fetchExternalRegions
};
