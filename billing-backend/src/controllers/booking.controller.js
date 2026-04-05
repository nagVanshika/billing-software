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
    
    // Optimized: Fetch all relevant external bookings ONCE and reuse
    const extBookings = await bookingService.fetchExternalBookings({ allPages: true, order: 'desc' });
    
    const [data, filtersData] = await Promise.all([
      bookingService.getBookingsList(page, limit, filters),
      bookingService.getCollectionFilters()
    ]);
    
    // Pass pre-fetched extBookings to stats helper functions
    const [stats, trend, regions] = await Promise.all([
      bookingService.getCollectionStats(period, dateFrom, dateTo, extBookings),
      bookingService.getRevenueTrend(period, dateFrom, dateTo, extBookings),
      bookingService.getRegionWiseRevenue(period, dateFrom, dateTo, extBookings)
    ]);
    
    res.status(200).json({ 
      success: true, 
      data: {
        ...data,
        filters: filtersData,
        stats,
        revenueTrend: trend,
        regionWiseRevenue: regions
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
