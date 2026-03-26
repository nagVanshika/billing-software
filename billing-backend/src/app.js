const express = require('express');
const helmet = require('helmet');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./config/logger');

// Register Models

require('./models/billing-expense');
require('./models/billing-category');

require('./models/Admin');

const app = express();
app.set('trust proxy', 1); // Trust first proxy for Vercel/Express rate limiting

app.get('/favicon.ico', (req, res) => res.status(204).end());

// Security Middleware
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(mongoSanitize());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes',
});
app.use('/api/', limiter);

// Request Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

const bookingRoutes = require('./routes/v1/booking.routes');
const expenseRoutes = require('./routes/v1/expense.routes');
const categoryRoutes = require('./routes/v1/category.routes');
const authRoutes = require('./routes/v1/auth.routes');

// Routes
app.use('/api/v1/bookings', bookingRoutes);
app.use('/api/v1/expenses', expenseRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/auth', authRoutes);

app.use('/api/v1/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Server is healthy' });
});

// 404 handler
app.use((req, res, next) => {
  const error = new Error('Not Found');
  error.statusCode = 404;
  error.errorCode = 'NOT_FOUND';
  next(error);
});

// Centralized Error Handler
app.use(errorHandler);

module.exports = app;
