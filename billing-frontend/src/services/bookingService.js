import axios from 'axios';
import api from './api';

const EXTERNAL_URL = 'https://app.carmaacarcare.com/api/admin/v1/get-bookings';

const bookingService = {
  getCollections: async (page = 1, limit = 10, filters = {}) => {
    try {
      // 1. Fetch system token from our backend
      const tokenResponse = await api.get('/auth/system-token');
      const systemToken = tokenResponse.token;

      // 2. Fetch from external API directly
      const extParams = {
        page,
        limit,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        region: filters.region,
        status: ['complete', 'completed', 'feedback done', 'Complete', 'Completed', 'Feedback Done'].join(','),
        order: 'desc'
      };

      const externalPromise = axios.get(EXTERNAL_URL, {
        headers: { Authorization: `Bearer ${systemToken}` },
        params: extParams,
        timeout: 10000
      }).catch(err => {
        console.error('External API fetch failed:', err.message);
        return { data: { success: true, data: { bookings: [] } } };
      });

      // 3. Fetch from our local backend (which now returns local collections + stats)
      const localParams = { page, limit, ...filters };
      const localPromise = api.get('/bookings/collections', { params: localParams });

      let externalResponse;
      let localResponse;

      try {
        localResponse = await localPromise;
        try {
          externalResponse = await externalPromise;
        } catch (err) {
          console.error("External failed:", err.message);
          externalResponse = { data: { data: { bookings: [] } } };
        }
      } catch (err) {
        throw err; // local failure is critical
      }

      const extBookings = (externalResponse.data?.result?.bookings || []).map(b => ({
        ...b,
        amount: parseFloat(b.payment?.price || 0),
        customerName: b.customerName || (b.customer_id && typeof b.customer_id === 'object' ? b.customer_id.name : 'Unknown'),
        category: b.category || { name: 'Bookings' },
        source: 'external-booking',
        booking_type: b.booking_type || 'system'
      }));

      const localData = localResponse.data;

      // Merge local and external
      const combined = [
        ...extBookings,
        ...localData.bookings
      ].sort((a, b) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        
        // Primary sort: Date descending (latest first)
        if (dateB !== dateA) {
          return dateB.localeCompare(dateA);
        }
        
        // Secondary sort: createdAt descending (using new Date for safety)
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });

      const extTotalPages = externalResponse.data?.result?.totalPages || 1;
      const localTotalPages = localData.pagination?.pages || 1;

      return {
        success: true,
        data: {
          bookings: combined,
          stats: localData.stats,
          filters: localData.filters,
          revenueTrend: localData.revenueTrend,
          regionWiseRevenue: localData.regionWiseRevenue,
          pagination: {
            ...localData.pagination,
            pages: Math.max(extTotalPages, localTotalPages)
          }
        }
      };
    } catch (error) {
      console.error('getCollections failed:', error);
      throw error;
    }
  },

  createCollection: async (collectionData) => {
    return api.post('/bookings/collections', collectionData);
  },
};

export default bookingService;
