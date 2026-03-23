import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Search, X, Check, Upload, Paperclip, FileText, ExternalLink } from 'lucide-react';
import expenseService from '../../services/expenseService';
import { useAuth } from '../../context/AuthContext';
import './Expenses.css';

const PAYMENT_MODES = ['Cash', 'Card', 'UPI', 'Bank Transfer', 'Cheque'];

const Expenses = () => {
  const { isAdmin } = useAuth();
  const [showAddModal, setShowAddModal] = useState(false);

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

    if (showAddModal) lock();
    else unlock();

    return unlock;
  }, [showAddModal]);

  const [expenses, setExpenses] = useState([]);
  const [stats, setStats] = useState({ totalAmount: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [availableFilters, setAvailableFilters] = useState({ categories: [], regions: [] });
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [filters, setFilters] = useState({ search: '', category: '', region: '', dateFrom: '', dateTo: '' });
  const [pendingFilters, setPendingFilters] = useState({ category: '', region: '', dateFrom: '', dateTo: '' });

  const observer = useRef();
  const lastExpenseElementRef = useCallback(node => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setPage(prevPage => prevPage + 1);
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, hasMore]);

  const emptyForm = {
    category: '',
    reason: '',
    expenseDate: new Date().toISOString().split('T')[0],
    paymentMode: '',
    paidBy: '',
    transactionId: '',
    amount: '',
    settled: 'No',
    region: '',
    notes: '',
    bill: null
  };
  const [formData, setFormData] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const fetchExpenses = async (pageNum = 1, isAppend = false) => {
    try {
      setLoading(true);
      const response = await expenseService.getExpenses({ ...filters, page: pageNum, limit: 20 });
      if (response.success && response.data) {
        if (isAppend) {
          setExpenses(prev => [...prev, ...response.data.expenses]);
        } else {
          setExpenses(response.data.expenses || []);
        }
        setStats(response.data.stats || { totalAmount: 0, count: 0 });
        if (response.data.filters) setAvailableFilters(response.data.filters);
        setHasMore(response.data.pagination.page < response.data.pagination.pages);
      }
    } catch (error) {
      console.error('Failed to fetch expenses:', error);
    } finally {
      setLoading(false);
    }
  };

  // Initial load or filter change
  useEffect(() => {
    setPage(1);
    fetchExpenses(1, false);
  }, [filters]);

  // Infinite scroll — next pages
  useEffect(() => {
    if (page > 1) fetchExpenses(page, true);
  }, [page]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setFilters(prev => ({ ...prev, search: searchTerm })), 500);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const applyFilters = () => {
    setPage(1);
    setFilters(prev => ({ ...prev, ...pendingFilters }));
  };

  const clearFilters = () => {
    const empty = { category: '', region: '', dateFrom: '', dateTo: '' };
    setPendingFilters(empty);
    setPage(1);
    setFilters(prev => ({ ...prev, ...empty }));
  };

  const hasActiveFilters = filters.category || filters.region || filters.dateFrom || filters.dateTo;

  const handleOpenModal = () => { setFormData(emptyForm); setFormError(''); setShowAddModal(true); };

  const handleFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmitExpense = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const data = new FormData();
      data.append('category', formData.category);
      // Find category name to help S3 naming
      const selectedCat = availableFilters.categories.find(c => c._id === formData.category);
      if (selectedCat) data.append('categoryName', selectedCat.name);
      
      data.append('reason', formData.reason);
      data.append('expenseDate', formData.expenseDate);
      data.append('paymentMode', formData.paymentMode);
      data.append('paidBy', formData.paidBy);
      data.append('transactionId', formData.transactionId);
      data.append('amount', formData.amount);
      data.append('settled', formData.settled);
      if (formData.region) data.append('region', formData.region);
      if (formData.notes) data.append('notes', formData.notes);
      if (formData.bill) data.append('bill', formData.bill);

      const res = await expenseService.createExpense(data);
      if (res.success) { setShowAddModal(false); fetchExpenses(); }
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to save expense');
    } finally {
      setSubmitting(false);
    }
  };

  const handleImportClick = () => {
    document.getElementById('import-input').click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImporting(true);
    setMessage({ type: '', text: '' });
    try {
      const res = await expenseService.importExpenses(file);
      if (res.success) {
        setMessage({ type: 'success', text: res.message });
        fetchExpenses();
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Failed to import expenses' });
    } finally {
      setImporting(false);
      e.target.value = ''; // clear input
    }
  };

  const StatCard = ({ title, value }) => (
    <div className="expense-stat">
      <h3>{title}</h3>
      <p>{value}</p>
    </div>
  );

  return (
    <div className="expenses-container">
      <div className="expenses-header">
        <div>
          <h1>Expenses</h1>
          <p>Track and manage company expenditures.</p>
        </div>
        <div className="header-actions">
          <input
            type="file"
            id="import-input"
            style={{ display: 'none' }}
            accept=".xlsx, .xls"
            onChange={handleFileChange}
          />
          {isAdmin && (
            <>
              <button className="btn-secondary" onClick={handleImportClick} disabled={importing}>
                <Upload size={18} />
                {importing ? 'Importing...' : 'Import Excel'}
              </button>
              <button className="btn-primary" onClick={handleOpenModal}>
                <Plus size={18} /> Add Expense
              </button>
            </>
          )}
        </div>
      </div>

      {message.text && (
        <div className={`notification-banner ${message.type}`}>
          {message.type === 'success' ? <Check size={18} /> : <X size={18} />}
          {message.text}
          <button className="close-notif" onClick={() => setMessage({ type: '', text: '' })}><X size={14} /></button>
        </div>
      )}

      <div className="expenses-stats">
        <StatCard title="Total Expense" value={`₹${stats.totalAmount.toLocaleString('en-IN')}`} />
        <StatCard title="Expense Count" value={stats.count} />
        <StatCard title="Last Updated" value={new Date().toLocaleDateString('en-IN')} />
      </div>

      {/* Search */}
      <div className="table-controls">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search by reason..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <div className="filter-group">
          <label>From</label>
          <input type="date" value={pendingFilters.dateFrom}
            onChange={e => setPendingFilters(f => ({ ...f, dateFrom: e.target.value }))} />
        </div>
        <div className="filter-group">
          <label>To</label>
          <input type="date" value={pendingFilters.dateTo}
            onChange={e => setPendingFilters(f => ({ ...f, dateTo: e.target.value }))} />
        </div>
        <div className="filter-group">
          <label>Category</label>
          <select value={pendingFilters.category}
            onChange={e => setPendingFilters(f => ({ ...f, category: e.target.value }))}>
            <option value="">All Categories</option>
            {availableFilters.categories.map(cat => (
              <option key={cat._id} value={cat._id}>{cat.name}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Region</label>
          <select value={pendingFilters.region}
            onChange={e => setPendingFilters(f => ({ ...f, region: e.target.value }))}>
            <option value="">All Regions</option>
            {availableFilters.regions.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="filter-actions">
          <button className="btn-apply" onClick={applyFilters}>Apply</button>
          {hasActiveFilters && (
            <button className="btn-clear" onClick={clearFilters}><X size={14} /> Clear</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table className="expenses-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Expense Reason</th>
              <th>Payment Date</th>
              <th>Payment Mode</th>
              <th>Paid By</th>
              <th>Transaction ID</th>
               <th>Amount</th>
              <th>Settled</th>
              <th>Bill</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 && !loading ? (
              <tr><td colSpan="9" className="table-empty">No expenses found.</td></tr>
            ) : (
              expenses.map((exp, index) => {
                const isLast = expenses.length === index + 1;
                return (
                  <tr key={exp._id} ref={isLast ? lastExpenseElementRef : null}>
                    <td data-label="Category"><span className="category-tag">{exp.category?.name || '—'}</span></td>
                    <td className="expense-reason" data-label="Reason">{exp.reason}</td>
                    <td data-label="Date">{new Date(exp.expenseDate).toLocaleDateString('en-IN')}</td>
                    <td data-label="Mode"><span className="mode-tag">{exp.paymentMode}</span></td>
                    <td data-label="Paid By">{exp.paidBy}</td>
                    <td className="txn-id" data-label="TXN ID">{exp.transactionId || '—'}</td>
                    <td className="expense-amount" data-label="Amount">₹{exp.amount.toLocaleString('en-IN')}</td>
                    <td data-label="Settled">
                      <span className={`settled-badge ${['yes', 'settled', 'true'].includes(exp.settled?.toLowerCase()) ? 'yes' : 'no'}`}>
                        {exp.settled}
                      </span>
                    </td>
                    <td data-label="Bill">
                      {exp.attachment ? (
                        <a 
                          href={exp.attachment.startsWith('http') ? exp.attachment : (window.location.hostname === 'localhost' ? `http://localhost:5001${exp.attachment}` : exp.attachment)} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="bill-link"
                          title="View Attachment"
                        >
                          <FileText size={16} />
                          <span>View</span>
                        </a>
                      ) : (
                        <span className="no-bill">—</span>
                      )}
                    </td>
                    <td className="expense-notes" data-label="Notes">{exp.notes || '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {loading && <div className="table-loading-overlay">Loading more expenses...</div>}
      </div>

      {/* Add Expense Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content modal-wide">
            <div className="modal-header">
              <h2>Add New Expense</h2>
              <button className="btn-close" onClick={() => setShowAddModal(false)}><X size={20} /></button>
            </div>
            <form className="expense-form" onSubmit={handleSubmitExpense}>
              <div className="form-grid">

                <div className="form-group">
                  <label>Category *</label>
                  <select name="category" value={formData.category} onChange={handleFormChange} required>
                    <option value="">Select Category</option>
                    {availableFilters.categories.map(cat => (
                      <option key={cat._id} value={cat._id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Expense Reason *</label>
                  <input type="text" name="reason" placeholder="e.g. Office Supplies"
                    value={formData.reason} onChange={handleFormChange} required />
                </div>

                <div className="form-group">
                  <label>Payment Date *</label>
                  <input type="date" name="expenseDate"
                    value={formData.expenseDate} onChange={handleFormChange} required />
                </div>

                <div className="form-group">
                  <label>Payment Mode *</label>
                  <input type="text" name="paymentMode" list="payment-modes" placeholder="e.g. UPI, Cash"
                    value={formData.paymentMode} onChange={handleFormChange} required />
                  <datalist id="payment-modes">
                    {PAYMENT_MODES.map(m => <option key={m} value={m} />)}
                  </datalist>
                </div>

                <div className="form-group">
                  <label>Paid By *</label>
                  <input type="text" name="paidBy" placeholder="e.g. John Doe"
                    value={formData.paidBy} onChange={handleFormChange} required />
                </div>

                <div className="form-group">
                  <label>Transaction ID</label>
                  <input type="text" name="transactionId" placeholder="Optional"
                    value={formData.transactionId} onChange={handleFormChange} />
                </div>

                <div className="form-group">
                  <label>Amount (₹) *</label>
                  <input type="number" name="amount" placeholder="0.00" min="0" step="0.01"
                    value={formData.amount} onChange={handleFormChange} required />
                </div>

                <div className="form-group">
                  <label>Settled Status</label>
                  <input type="text" name="settled" placeholder="e.g. Yes, No Need, Pending"
                    value={formData.settled} onChange={handleFormChange} />
                </div>

                <div className="form-group">
                  <label>Region</label>
                  <select name="region" value={formData.region} onChange={handleFormChange}>
                    <option value="">Select Region</option>
                    {availableFilters.regions.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group full-width">
                  <label>Notes</label>
                  <textarea name="notes" placeholder="Additional details..." rows="3"
                    value={formData.notes || ''} onChange={handleFormChange}
                    style={{ padding: '11px 12px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.95rem', outline: 'none', background: 'white' }} />
                </div>

                <div className="form-group full-width">
                  <label>Attach Bill (Image, PDF, Doc)</label>
                  <div className="file-upload-wrapper">
                    <input 
                      type="file" 
                      id="bill-upload"
                      accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
                      onChange={(e) => setFormData(prev => ({ ...prev, bill: e.target.files[0] }))}
                      className="hidden-input"
                    />
                    <label htmlFor="bill-upload" className="file-upload-label">
                      <Paperclip size={18} />
                      {formData.bill ? (
                        <span className="file-name">{formData.bill.name}</span>
                      ) : (
                        <span className="upload-placeholder">Choose a file or drag here</span>
                      )}
                    </label>
                  </div>
                </div>

              </div>

              {formError && <p className="form-error">{formError}</p>}

              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Expenses;
