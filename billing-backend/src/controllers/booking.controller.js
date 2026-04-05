const bookingService = require('../services/booking.service');
const ApiResponse = require('../utils/ApiResponse');
const logger = require('../config/logger');
const { sendSlackNotification } = require('../utils/slack');

const getCollections = async (req, res, next) => {
// ...
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const { dateFrom, dateTo, region, category, period } = req.query;
    
    const filters = { dateFrom, dateTo, region, category };
    
    // Fetch two sets: all statuses (for total count) and completed only (for revenue/trend/region)
    const [extBookingsAll, extBookingsCompleted, data, filtersData] = await Promise.all([
      bookingService.fetchExternalBookings({ allPages: true, order: 'desc', status: 'all' }),
      bookingService.fetchExternalBookings({ allPages: true, order: 'desc' }),
      bookingService.getBookingsList(page, limit, filters),
      bookingService.getCollectionFilters()
    ]);

    // Stats uses all-statuses bookings so count is accurate; revenue/trend/region use completed-only
    const [stats, trend, regions, categories] = await Promise.all([
      bookingService.getCollectionStats(period, dateFrom, dateTo, extBookingsAll),
      bookingService.getRevenueTrend(period, dateFrom, dateTo, extBookingsCompleted),
      bookingService.getRegionWiseRevenue(period, dateFrom, dateTo, extBookingsCompleted),
      bookingService.getCategoryWiseRevenue(period, dateFrom, dateTo, extBookingsCompleted)
    ]);
    
    res.status(200).json({ 
      success: true, 
      data: {
        ...data,
        filters: filtersData,
        stats,
        revenueTrend: trend,
        regionWiseRevenue: regions,
        categoryWiseRevenue: categories
      } 
    });
  } catch (error) {
    logger.error('Error in getCollections controller:', error);
    next(error);
  }
};

const createCollection = async (req, res, next) => {
  try {
    const booking = await bookingService.createBooking(req.body);

    // Populate category to get the name for Slack
    if (booking.category) {
      await booking.populate('category', 'name');
    }

    // Send Slack Notification
    sendSlackNotification({
      expense_id: booking._id,
      customerName: booking.customerName,
      categoryName: booking.category?.name || 'Manual',
      amount: booking.amount,
      channel: process.env.SLACK_CHANNEL || 'carmaa-bills-update',
      type: 'Collection'
    }).catch(err => console.error('Slack notification failed for collection:', err));

    res.status(201).json({
      success: true,
      data: booking
    });
  } catch (error) {
    logger.error('Error in createCollection controller:', error);
    next(error);
  }
};

const getCollectionDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const booking = await bookingService.getBookingDetail(id);
    
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    res.status(200).json({
      success: true,
      data: booking
    });
  } catch (error) {
    logger.error('Error in getCollectionDetail controller:', error);
    next(error);
  }
};

const updateCollection = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await bookingService.updateBooking(id, req.body);

    res.status(200).json({
      success: true,
      message: 'Collection updated successfully',
      data: updated
    });
  } catch (error) {
    logger.error('Error in updateCollection controller:', error);
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const deleteCollection = async (req, res, next) => {
  try {
    const { id } = req.params;
    await bookingService.softDeleteBooking(id);

    res.status(200).json({
      success: true,
      message: 'Collection deleted successfully'
    });
  } catch (error) {
    logger.error('Error in deleteCollection controller:', error);
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

module.exports = {
  getCollections,
  createCollection,
  getCollectionDetail,
  updateCollection,
  deleteCollection
};
