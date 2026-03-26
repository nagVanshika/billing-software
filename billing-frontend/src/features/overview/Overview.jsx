import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line, Legend 
} from 'recharts';
import { TrendingUp, DollarSign, Calendar } from 'lucide-react';
import bookingService from '../../services/bookingService';
import expenseService from '../../services/expenseService';
import './Overview.css';

const Overview = () => {
  const [stats, setStats] = useState({ totalCollection: 0, count: 0 });
  const [revenueTrend, setRevenueTrend] = useState([]);
  const [regionData, setRegionData] = useState([]);
  const [categoryData, setCategoryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('today');
  const [customDates, setCustomDates] = useState({ 
    from: new Date().toISOString().split('T')[0], 
    to: new Date().toISOString().split('T')[0] 
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const params = { period };
        if (period === 'custom') {
          params.dateFrom = customDates.from;
          params.dateTo = customDates.to;
        }

        const [bookingRes, expenseRes] = await Promise.all([
          bookingService.getCollections(1, 10, params),
          expenseService.getExpenseStats(params)
        ]);

        if (bookingRes.success) {
          setStats(bookingRes.data.stats);
          setRevenueTrend(bookingRes.data.revenueTrend);
          setRegionData(bookingRes.data.regionWiseRevenue);
        }

        if (expenseRes.success) {
          setCategoryData(expenseRes.data.categoryStats);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [period, customDates]);

  const COLORS = ['#1B4E9B', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#EC4899'];

  const StatCard = ({ title, value, icon, trend, color, isLoading, trendValue }) => (
    <div className="stat-card">
      <div className="stat-icon" style={{ backgroundColor: `${color}15`, color: color }}>
        {icon}
      </div>
      <div className="stat-details">
        <h3>{title}</h3>
        {isLoading ? (
          <p className="stat-value animate-pulse">...</p>
        ) : (
          <div className="stat-value-container">
            <p className="stat-value">{value}</p>
            {trendValue !== undefined && (
              <span className={`stat-trend ${trendValue >= 0 ? 'up' : 'down'}`}>
                {trendValue >= 0 ? '↑' : '↓'} {Math.abs(trendValue).toFixed(1)}%
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );



  return (
    <div className="overview-container">
      <div className="overview-header">
        <div>
          <h1>Overview</h1>
          <p>Analytics and financial insights for your business.</p>
        </div>
        
        <div className="period-selector">
          <button 
            className={`period-btn ${period === 'today' ? 'active' : ''}`}
            onClick={() => setPeriod('today')}
          >
            Today
          </button>
          <button 
            className={`period-btn ${period === 'weekly' ? 'active' : ''}`}
            onClick={() => setPeriod('weekly')}
          >
            Weekly
          </button>
          <button 
            className={`period-btn ${period === 'monthly' ? 'active' : ''}`}
            onClick={() => setPeriod('monthly')}
          >
            Monthly
          </button>
          <button 
            className={`period-btn ${period === 'total' ? 'active' : ''}`}
            onClick={() => setPeriod('total')}
          >
            All Time
          </button>
          <button 
            className={`period-btn ${period === 'custom' ? 'active' : ''}`}
            onClick={() => setPeriod('custom')}
          >
            Custom
          </button>
        </div>
      </div>

      {period === 'custom' && (
        <div className="custom-date-selector">
          <div className="date-input-group">
            <label>From:</label>
            <input 
              type="date" 
              value={customDates.from}
              onChange={(e) => setCustomDates(prev => ({ ...prev, from: e.target.value }))}
            />
          </div>
          <div className="date-input-group">
            <label>To:</label>
            <input 
              type="date" 
              value={customDates.to}
              onChange={(e) => setCustomDates(prev => ({ ...prev, to: e.target.value }))}
            />
          </div>
        </div>
      )}

      <div className="stats-grid">
        <StatCard title="Total Revenue" value={`₹${stats.totalCollection.toLocaleString('en-IN')}`} icon={<DollarSign size={20} />} color="#1B4E9B" isLoading={loading} />
        <StatCard title="Total Bookings" value={stats.count.toLocaleString()} icon={<Calendar size={20} />} color="#1B4E9B" isLoading={loading} />
      </div>

      <div className="charts-grid">
        <div className="chart-wrapper main-chart">
          <h3>Revenue Over Time</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} dy={10} />
                <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `₹${value}`} />
                <Tooltip 
                  formatter={(value) => [`₹${value.toLocaleString('en-IN')}`, 'Revenue']}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Line type="monotone" dataKey="revenue" stroke="#1B4E9B" strokeWidth={3} dot={{ r: 6 }} activeDot={{ r: 8 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-wrapper">
          <h3>Region-wise Payments</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={regionData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} dy={10} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip 
                   contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="value" fill="#1B4E9B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-wrapper">
          <h3>Category Distribution</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend layout="vertical" align="right" verticalAlign="middle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Overview;
