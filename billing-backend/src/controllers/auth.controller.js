const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const logger = require('../config/logger');

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });
};

const sendToken = (user, statusCode, res) => {
  const token = signToken(user._id);

  // Remove password from output
  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};

exports.login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // 1) Check if username and password exist
    if (!username || !password) {
      return res.status(400).json({
        status: 'fail',
        message: 'Please provide username and password!',
      });
    }

    // 2) Check if user exists && password is correct
    const user = await Admin.findOne({ username }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        status: 'fail',
        message: 'Incorrect username or password',
      });
    }

    // 3) If everything ok, send token to client
    sendToken(user, 200, res);
  } catch (err) {
    logger.error('Login error:', err);
    next(err);
  }
};

// Seeding function for initial admins
exports.seedAdmins = async (req, res, next) => {
  try {
    // Check if admins already exist to prevent duplicate seeding
    const adminCount = await Admin.countDocuments();
    if (adminCount > 0) {
      return res.status(400).json({
        status: 'fail',
        message: 'Admins already exist. Seeding aborted.',
      });
    }

    const admins = [
      {
        username: 'superadmin',
        password: 'password123',
        name: 'Super Admin',
        role: 'super_admin',
      },
      {
        username: 'readonly',
        password: 'password123',
        name: 'Read Only Admin',
        role: 'read_only',
      },
    ];

    await Admin.create(admins);

    res.status(201).json({
      status: 'success',
      message: 'Initial admins seeded successfully',
    });
  } catch (err) {
    logger.error('Seeding error:', err);
    next(err);
  }
};

/**
 * Generate a system token for external API calls from the frontend
 */
exports.getSystemToken = async (req, res, next) => {
  try {
    const token = jwt.sign(
      { type: 'system', name: 'BillingFrontend' },
      process.env.EXTERNAL_API_SECRET || process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({
      status: 'success',
      token
    });
  } catch (err) {
    logger.error('System token generation error:', err);
    next(err);
  }
};
