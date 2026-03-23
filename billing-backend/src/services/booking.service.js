const { Booking } = require('../models/Booking');
const Collection = require('../models/billing-collection');
const Category = require('../models/billing-category');

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
 * Statuses: complete, completed, feedback done
 */
const getCollectionStats = async (period = 'total', dateFrom, dateTo) => {
  const statuses = ['complete', 'completed', 'feedback done', 'Complete', 'Completed', 'Feedback Done'];
  const dateFilter = getDateRange(period, dateFrom, dateTo);
  
  const matchQuery = { status: { $in: statuses } };
  if (dateFilter) matchQuery.date = dateFilter;

  // Helper for actual fetch
  const fetchTotal = async (query) => {
    const [bStats, cStats] = await Promise.all([
      Booking.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: { $convert: { input: "$payment.price", to: "double", onError: 0, onNull: 0 } } }, count: { $sum: 1 } } }
      ]),
      Collection.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: { $convert: { input: "$amount", to: "double", onError: 0, onNull: 0 } } } } }
      ])
    ]);
    return (bStats[0]?.total || 0) + (cStats[0]?.total || 0);
  };

  const currentTotal = await fetchTotal(matchQuery);
  const totalCount = await Booking.countDocuments(matchQuery);

  // Calculate previous period total
  let previousTotal = 0;
  let prevFilter = null;

  if (period === 'today') {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    prevFilter = { $eq: yesterday.toISOString().split('T')[0] };
  } else if (period === 'weekly') {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    prevFilter = { 
      $gte: twoWeeksAgo.toISOString().split('T')[0], 
      $lt: weekAgo.toISOString().split('T')[0] 
    };
  } else if (period === 'monthly') {
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setDate(twoMonthsAgo.getDate() - 60);
    prevFilter = { 
      $gte: twoMonthsAgo.toISOString().split('T')[0], 
      $lt: monthAgo.toISOString().split('T')[0] 
    };
  } else if (period === 'custom' && dateFrom && dateTo) {
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    const diff = end - start;
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(start.getTime() - diff);
    prevFilter = { 
      $gte: prevStart.toISOString().split('T')[0], 
      $lte: prevEnd.toISOString().split('T')[0] 
    };
  }

  if (prevFilter) {
    previousTotal = await fetchTotal({ status: { $in: statuses }, date: prevFilter });
  }

  return {
    totalCollection: currentTotal,
    previousTotalCollection: previousTotal,
    count: totalCount
  };
};

/**
 * Get revenue trend data based on period
 */
const getRevenueTrend = async (period = 'total', dateFrom, dateTo) => {
  const statuses = ['complete', 'completed', 'feedback done', 'Complete', 'Completed', 'Feedback Done'];
  const dateFilter = getDateRange(period, dateFrom, dateTo);
  const matchQuery = { status: { $in: statuses } };
  if (dateFilter) matchQuery.date = dateFilter;

  if (period === 'today') {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const [bStats, cStats] = await Promise.all([
      Booking.aggregate([
        { $match: { status: { $in: statuses }, createdAt: { $gte: todayStart } } },
        {
          $group: {
            _id: { $substr: [{ $dateToString: { date: "$createdAt", timezone: "UTC" } }, 11, 2] },
            revenue: { $sum: { $convert: { input: "$payment.price", to: "double", onError: 0, onNull: 0 } } }
          }
        }
      ]),
      Collection.aggregate([
        { $match: { status: { $in: statuses }, createdAt: { $gte: todayStart } } },
        {
          $group: {
            _id: { $substr: [{ $dateToString: { date: "$createdAt", timezone: "UTC" } }, 11, 2] },
            revenue: { $sum: "$amount" }
          }
        }
      ])
    ]);

    const combined = [...bStats, ...cStats];
    const hourly = {};
    combined.forEach(item => {
      hourly[item._id] = (hourly[item._id] || 0) + item.revenue;
    });

    return Object.keys(hourly).sort().map(hour => ({
      month: `${hour}:00`,
      revenue: hourly[hour]
    }));
  }

  if (period === 'weekly' || period === 'monthly') {
    const [bStats, cStats] = await Promise.all([
      Booking.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: "$date",
            revenue: { $sum: { $convert: { input: "$payment.price", to: "double", onError: 0, onNull: 0 } } }
          }
        }
      ]),
      Collection.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: "$date",
            revenue: { $sum: "$amount" }
          }
        }
      ])
    ]);

    const combined = [...bStats, ...cStats];
    const daily = {};
    combined.forEach(item => {
      daily[item._id] = (daily[item._id] || 0) + item.revenue;
    });

    return Object.keys(daily).sort().map(date => ({
      month: date,
      revenue: daily[date]
    }));
  }

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const sixMonthFilter = { date: { $gte: sixMonthsAgo.toISOString().split('T')[0] }, status: { $in: statuses } };

  const [bStats, cStats] = await Promise.all([
    Booking.aggregate([
      { $match: sixMonthFilter },
      {
        $group: {
          _id: { $substr: ["$date", 0, 7] },
          revenue: { $sum: { $convert: { input: "$payment.price", to: "double", onError: 0, onNull: 0 } } }
        }
      }
    ]),
    Collection.aggregate([
      { $match: sixMonthFilter },
      {
        $group: {
          _id: { $substr: ["$date", 0, 7] },
          revenue: { $sum: "$amount" }
        }
      }
    ])
  ]);

  const combined = [...bStats, ...cStats];
  const monthly = {};
  combined.forEach(item => {
    monthly[item._id] = (monthly[item._id] || 0) + item.revenue;
  });

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return Object.keys(monthly).sort().map(item => {
    const [year, month] = item.split('-');
    return {
      month: `${monthNames[parseInt(month) - 1]}`,
      revenue: monthly[item]
    };
  });
};

/**
 * Get revenue grouped by region
 */
const getRegionWiseRevenue = async (period = 'total', dateFrom, dateTo) => {
  const statuses = ['complete', 'completed', 'feedback done', 'Complete', 'Completed', 'Feedback Done'];
  const dateFilter = getDateRange(period, dateFrom, dateTo);
  const matchQuery = { status: { $in: statuses } };
  if (dateFilter) matchQuery.date = dateFilter;

  const [bStats, cStats] = await Promise.all([
    Booking.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$address.region",
          value: { $sum: { $convert: { input: "$payment.price", to: "double", onError: 0, onNull: 0 } } }
        }
      }
    ]),
    Collection.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$region",
          value: { $sum: "$amount" }
        }
      }
    ])
  ]);

  const regions = {};
  [...bStats, ...cStats].forEach(item => {
    const name = item._id || 'Other';
    regions[name] = (regions[name] || 0) + item.value;
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
  const statuses = ['complete', 'completed', 'feedback done', 'Complete', 'Completed', 'Feedback Done'];
  const bookingsCat = await Category.findOne({ name: 'Bookings' });

  // Booking Query
  const bQuery = { status: { $in: statuses } };
  if (filters.dateFrom || filters.dateTo) {
    bQuery.date = {};
    if (filters.dateFrom) bQuery.date.$gte = filters.dateFrom;
    if (filters.dateTo) bQuery.date.$lte = filters.dateTo;
  }
  if (filters.region) bQuery['address.region'] = filters.region;
  if (filters.category) {
    if (bookingsCat && filters.category === bookingsCat._id.toString()) {
      bQuery.$or = [{ category: filters.category }, { category: { $exists: false } }, { category: null }];
    } else {
      bQuery.category = filters.category;
    }
  }

  // Collection Query
  const cQuery = { status: { $in: statuses } };
  if (filters.dateFrom || filters.dateTo) {
    cQuery.date = {};
    if (filters.dateFrom) cQuery.date.$gte = filters.dateFrom;
    if (filters.dateTo) cQuery.date.$lte = filters.dateTo;
  }
  if (filters.region) cQuery.region = filters.region;
  if (filters.category) {
    // If filtering by "Bookings" category, we exclude Collections unless they happen to have it (unlikely)
    if (bookingsCat && filters.category === bookingsCat._id.toString()) {
      cQuery._id = null; // Forces empty result if specifically asking for system bookings
    } else {
      cQuery.category = filters.category;
    }
  }

  // Fetch both manually for now and merge
  // In a real high-scale app, we might use a different approach
  const [bookings, collections] = await Promise.all([
    Booking.find(bQuery).populate('customer_id', 'name').populate('category', 'name').sort({ date: -1, createdAt: -1 }).limit(100).lean(),
    Collection.find(cQuery).populate('category', 'name').sort({ date: -1, createdAt: -1 }).limit(100).lean()
  ]);

  const combined = [
    ...bookings.map(b => ({
      ...b,
      amount: parseFloat(b.payment?.price || 0),
      customerName: b.customerName || b.customer_id?.name || 'Unknown',
      category: b.category || (bookingsCat ? { _id: bookingsCat._id, name: 'Bookings' } : { name: 'Bookings' }),
      source: 'booking'
    })),
    ...collections.map(c => ({
      ...c,
      amount: c.amount,
      payment: { price: c.amount.toString() },
      category: c.category || { name: 'Manual' },
      source: 'collection'
    }))
  ].sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const skip = (page - 1) * limit;
  const paginated = combined.slice(skip, skip + limit);
  const total = bookings.length + collections.length;

  return {
    bookings: paginated,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  };
};

/**
 * Get available filters for collections (regions and collection-type categories)
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
  createBooking
};
