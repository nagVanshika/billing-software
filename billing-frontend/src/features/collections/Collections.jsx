import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DollarSign, X, Plus, User, MapPin, Calendar, Clock, CreditCard, Car, ChevronRight, CheckCircle, Info } from 'lucide-react';
import bookingService from '../../services/bookingService';
import expenseService from '../../services/expenseService';
import { useAuth } from '../../context/AuthContext';
import './Collections.css';

const Collections = () => {
  const { isAdmin } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [stats, setStats] = useState({ totalCollection: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', region: '', category: '' });
  const [appliedFilters, setAppliedFilters] = useState({ dateFrom: '', dateTo: '', region: '', category: '' });
  const [availableFilters, setAvailableFilters] = useState({ categories: [], regions: [] });

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newCollection, setNewCollection] = useState({
    customerName: '',
    date: new Date().toISOString().split('T')[0],
    price: '',
    category: '',
    region: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Detail Modal State
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  
  // Body scroll lock
  useEffect(() => {
    const lock = () => {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      document.body.classList.add('modal-open');
    };
    const unlock = () => {
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
      document.body.classList.remove('modal-open');
    };

    if (isModalOpen || isDetailModalOpen) lock();
    else unlock();
 
    return unlock;
  }, [isModalOpen, isDetailModalOpen]);

  const observer = useRef();
  const lastBookingElementRef = useCallback(node => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setPage(prevPage => prevPage + 1);
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, hasMore]);

  const fetchData = async (pageNum, isInitial = false, activeFilters = appliedFilters) => {
    try {
      setLoading(true);
      const response = await bookingService.getCollections(pageNum, 20, activeFilters);
      if (response.success) {
        if (isInitial) {
          setBookings(response.data.bookings);
          setStats(response.data.stats);
        } else {
          setBookings(prev => [...prev, ...response.data.bookings]);
        }
        if (response.data.filters) setAvailableFilters(response.data.filters);
        setHasMore(response.data.pagination.page < response.data.pagination.pages);
      }
    } catch (error) {
      console.error('Failed to fetch collections:', error);
    } finally {
      setLoading(false);
    }
  };


  // Initial load
  useEffect(() => {
    fetchData(1, true, appliedFilters);
  }, [appliedFilters]);

  // Infinite scroll — next pages
  useEffect(() => {
    if (page > 1) fetchData(page, false, appliedFilters);
  }, [page]);

  const applyFilters = () => {
    setPage(1);
    setBookings([]);
    setAppliedFilters({ ...filters });
  };

  const clearFilters = () => {
    const empty = { dateFrom: '', dateTo: '', region: '', category: '' };
    setFilters(empty);
    setPage(1);
    setBookings([]);
    setAppliedFilters(empty);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newCollection.customerName || !newCollection.price) return;

    try {
      setIsSubmitting(true);
      const payload = {
        customerName: newCollection.customerName,
        date: newCollection.date,
        payment: { price: newCollection.price },
        category: newCollection.category || null,
        address: { region: newCollection.region || 'Unknown' }
      };

      const response = await bookingService.createCollection(payload);
      if (response.success) {
        setIsModalOpen(false);
        setNewCollection({
          customerName: '',
          date: new Date().toISOString().split('T')[0],
          price: '',
          category: '',
          region: ''
        });
        setPage(1);
        setBookings([]);
        fetchData(1, true);
      }
    } catch (error) {
      console.error('Failed to create collection:', error);
    } finally {
      setIsSubmitting(false);
    }
  };
 
  const handleRowClick = async (booking) => {
    try {
      setDetailLoading(true);
      setIsDetailModalOpen(true);
      const response = await bookingService.getBookingDetail(booking._id, booking.source);
      if (response.success) {
        setSelectedBooking(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch booking details:', error);
    } finally {
      setDetailLoading(false);
    }
  };
 
  const closeDetailModal = () => {
    setIsDetailModalOpen(false);
    setSelectedBooking(null);
  };

  const hasActiveFilters = appliedFilters.dateFrom || appliedFilters.dateTo || appliedFilters.region || appliedFilters.category;

  return (
    <div className="collections-container">
      <div className="collections-header">
        <div>
          <h1>Money Collection</h1>
          <p>Track bookings and manage revenue flow.</p>
        </div>
        {isAdmin && (
          <button className="btn-add-collection" onClick={() => setIsModalOpen(true)}>
            <Plus size={18} /> Add Collection
          </button>
        )}
      </div>

      <div className="collections-summary">
        <div className="summary-card">
          <div className="summary-icon">
            <DollarSign size={24} />
          </div>
          <div className="summary-details">
            <h3>Total Sales (Cleared)</h3>
            <p className="summary-value">₹{stats.totalCollection.toLocaleString('en-IN')}</p>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon pending">
            <DollarSign size={24} />
          </div>
          <div className="summary-details">
            <h3>Total Bookings</h3>
            <p className="summary-value">{stats.count}</p>
          </div>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div className="filter-bar">
        <div className="filter-group">
          <label>From</label>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
          />
        </div>
        <div className="filter-group">
          <label>To</label>
          <input
            type="date"
            value={filters.dateTo}
            onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
          />
        </div>
        <div className="filter-group">
          <label>Region</label>
          <select
            value={filters.region}
            onChange={e => setFilters(f => ({ ...f, region: e.target.value }))}
          >
            <option value="">All Regions</option>
            {availableFilters.regions.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Category</label>
          <select
            value={filters.category}
            onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
          >
            <option value="">All Categories</option>
            {availableFilters.categories.map(cat => (
              <option key={cat._id} value={cat._id}>{cat.name}</option>
            ))}
          </select>
        </div>
        <div className="filter-actions">
          <button className="btn-apply" onClick={applyFilters}>Apply</button>
          {hasActiveFilters && (
            <button className="btn-clear" onClick={clearFilters}>
              <X size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="table-wrapper">
        {bookings.length === 0 && !loading ? (
          <div className="empty-state">No bookings found{hasActiveFilters ? ' for the selected filters' : ' in database'}.</div>
        ) : (
          <table className="bookings-table">
            <thead>
              <tr>
                <th>Customer Name</th>
                <th>Category</th>
                <th>Booking Type</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking, index) => {
                const isLastElement = bookings.length === index + 1;
                return (
                  <tr 
                    key={booking._id} 
                    ref={isLastElement ? lastBookingElementRef : null}
                    onClick={() => handleRowClick(booking)}
                    className="booking-row"
                  >
                    <td className="customer-name" data-label="Reason">{booking.customerName}</td>
                    <td data-label="Category"><span className="category-tag">{booking.category?.name || '—'}</span></td>
                    <td data-label="Type">{booking.booking_type}</td>
                    <td data-label="Date">{booking.date}</td>
                    <td className="amount" data-label="Amount">₹{booking.payment?.price?.toLocaleString('en-IN') || 0}</td>
                    <td data-label="Status">
                      <span className={`status-badge ${(booking.status || 'pending').replace(' ', '-').toLowerCase()}`}>
                        {booking.status || 'Pending'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {loading && <div className="loading-state">Loading more bookings...</div>}
      </div>

      {/* ── Add Collection Modal ── */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Add Manual Collection</h2>
              <button className="btn-close" onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleCreate}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Customer Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter customer name"
                    value={newCollection.customerName}
                    onChange={e => setNewCollection(prev => ({ ...prev, customerName: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label>Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    placeholder="0.00"
                    value={newCollection.price}
                    onChange={e => setNewCollection(prev => ({ ...prev, price: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label>Date</label>
                  <input
                    type="date"
                    value={newCollection.date}
                    onChange={e => setNewCollection(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label>Category</label>
                  <select
                    value={newCollection.category}
                    onChange={e => setNewCollection(prev => ({ ...prev, category: e.target.value }))}
                  >
                    <option value="">Select Category</option>
                    {availableFilters.categories.map(cat => (
                      <option key={cat._id} value={cat._id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group full-width">
                  <label>Region</label>
                  <select
                    value={newCollection.region}
                    onChange={e => setNewCollection(prev => ({ ...prev, region: e.target.value }))}
                  >
                    <option value="">Select Region</option>
                    {availableFilters.regions.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn-cancel" 
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving...' : 'Save Collection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Booking Detail Modal ── */}
      {isDetailModalOpen && (
        <div className="modal-overlay" onClick={closeDetailModal}>
          <div className="modal-content detail-modal premium-detail" onClick={e => e.stopPropagation()}>
            <div className="modal-header-premium">
              <div className="header-main">
                <div className="header-text">
                  <span className="booking-type-tag">{selectedBooking?.booking_type || 'System'} Booking</span>
                  <h2>Transaction Details</h2>
                  <span className="premium-id-tag">ID: {selectedBooking?._id || '...'}</span>
                </div>
                {selectedBooking && (
                  <div className={`status-pill-large ${(selectedBooking.status || 'pending').replace(' ', '-').toLowerCase()}`}>
                    <CheckCircle size={16} />
                    {selectedBooking.status}
                  </div>
                )}
              </div>
              <button className="btn-close-premium" onClick={closeDetailModal}>
                <X size={20} />
              </button>
            </div>

            <div className="detail-body-premium">
              {detailLoading ? (
                <div className="detail-loading-premium">
                  <div className="loader-ring"></div>
                  <p>Synchronizing with system...</p>
                </div>
              ) : selectedBooking ? (
                <div className="premium-grid-layout">
                  {/* ── Left Column: Basic Info & Vehicle ── */}
                  <div className="premium-col">
                    <div className="premium-card">
                      <div className="card-header-icon">
                        <User size={18} />
                        <h4>Customer Details</h4>
                      </div>
                      <div className="card-content">
                        <div className="info-row">
                          <label>Full Name</label>
                          <p className="highlight">{selectedBooking.customerName || selectedBooking.customer_id?.name || 'N/A'}</p>
                        </div>
                        <div className="info-row">
                          <label>Contact Number</label>
                          <p>{selectedBooking.customer_id?.phone || selectedBooking.phone || 'N/A'}</p>
                        </div>
                        {selectedBooking.customer_id?.email && (
                          <div className="info-row">
                            <label>Email Address</label>
                            <p>{selectedBooking.customer_id.email}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="premium-card">
                      <div className="card-header-icon">
                        <Calendar size={18} />
                        <h4>Schedule & Location</h4>
                      </div>
                      <div className="card-content">
                        <div className="info-row">
                          <label>Service Date</label>
                          <div className="icon-text">
                            <Calendar size={14} className="small-icon" />
                            <p>{selectedBooking.date}</p>
                          </div>
                        </div>
                        {selectedBooking.time && (
                          <div className="info-row">
                            <label>Arrival Time</label>
                            <div className="icon-text">
                              <Clock size={14} className="small-icon" />
                              <p>{selectedBooking.time}</p>
                            </div>
                          </div>
                        )}
                        <div className="info-row">
                          <label>Region/Station</label>
                          <div className="icon-text">
                            <MapPin size={14} className="small-icon" />
                            <p>{selectedBooking.address?.region || selectedBooking.region || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Right Column: Services & Payment ── */}
                  <div className="premium-col">
                    <div className="premium-card highlight-border">
                      <div className="card-header-icon">
                        <Car size={18} />
                        <h4>Services & Vehicles</h4>
                      </div>
                      <div className="card-content">
                        {selectedBooking.bill_details?.booked_services?.length > 0 ? (
                          <div className="booked-services-list">
                            {selectedBooking.bill_details.booked_services.map((item, idx) => (
                              <div key={idx} className="booked-service-card">
                                <div className="vehicle-mini-header">
                                  {item.vehicle?.carImage && (
                                    <img src={item.vehicle.carImage} alt="Car" className="mini-car-img" />
                                  )}
                                  <div className="v-data">
                                    <h5>{item.vehicle?.carName || item.service_name}</h5>
                                    <span>#{item.user_vehicle_id?.slice(-6).toUpperCase()}</span>
                                  </div>
                                </div>
                                <div className="nested-tags">
                                  {item.services?.map((s, sIdx) => (
                                    <span key={sIdx} className="nested-tag">{s.id?.name || s.name}</span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : selectedBooking.car_id ? (
                          <div className="simple-vehicle-info">
                            <div className="v-row">
                              <label>Model</label>
                              <p>{selectedBooking.car_id.make} {selectedBooking.car_id.model}</p>
                            </div>
                            <div className="v-row">
                              <label>Registration</label>
                              <p className="reg-tag">{selectedBooking.car_id.reg_number}</p>
                            </div>
                          </div>
                        ) : (
                          <p className="empty-text">No detailed service breakdown available.</p>
                        )}
                      </div>
                    </div>

                    <div className="premium-card payment-card">
                      <div className="card-header-icon">
                        <CreditCard size={18} />
                        <h4>Payment Summary</h4>
                      </div>
                      <div className="card-content payment-details">
                        <div className="payment-row">
                          <span>Subtotal</span>
                          <span>₹{selectedBooking.payment?.price?.toLocaleString('en-IN') || 0}</span>
                        </div>
                        {selectedBooking.payment?.discount > 0 && (
                          <div className="payment-row discount">
                            <span>Promotional Discount</span>
                            <span>- ₹{selectedBooking.payment.discount.toLocaleString('en-IN')}</span>
                          </div>
                        )}
                        <div className="payment-divider"></div>
                        <div className="payment-row final">
                          <div className="total-label">
                            <span className="l-text">Amount Settled</span>
                            <span className="l-sub">via {selectedBooking.payment?.method || 'Method'}</span>
                          </div>
                          <span className="total-val">₹{selectedBooking.amount?.toLocaleString('en-IN') || selectedBooking.payment?.price?.toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="detail-error-premium">
                  <Info size={48} className="err-icon" />
                  <h3>Data Unavailable</h3>
                  <p>We couldn't synchronize the details for this record. Please try again or contact support.</p>
                </div>
              )}
            </div>

            <div className="modal-footer-premium">
              <button className="btn-secondary-premium" onClick={closeDetailModal}>Close Review</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Collections;
