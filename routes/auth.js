/**
 * routes/auth.js - Customer Authentication Routes
 *
 * Routes:
 *   POST   /api/auth/register        - Register new customer
 *   POST   /api/auth/login           - Login (email OR mobile + password)
 *   GET    /api/auth/profile         - Get current user profile (protected)
 *   PUT    /api/auth/profile         - Update profile (name, addresses) (protected)
 *   PUT    /api/auth/change-password - Change password (protected)
 *   GET    /api/auth/orders          - Get user's order history (protected)
 */

'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');

const User = require('../models/User');
const Order = require('../models/Order');
const OTP = require('../models/OTP');
const { protect } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const sendEmail = require('../utils/sendEmail');

const router = express.Router();

// ─── Helper: Format validation errors ────────────────────
const handleValidationErrors = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  return null;
};

// ─── Helper: Send token response ─────────────────────────
const sendTokenResponse = (user, statusCode, res) => {
  const token = user.generateAuthToken();

  // Set secure httpOnly cookie as an additional security measure
  res.cookie('seawave_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days in milliseconds
  });

  return res.status(statusCode).json({
    success: true,
    token,
    user: {
      _id:        user._id,
      name:       user.name,
      email:      user.email,
      mobile:     user.mobile,
      isVerified: user.isVerified,
      addresses:  user.addresses,
      createdAt:  user.createdAt,
    },
  });
};

// ─── Helper: Generate OTP ────────────────────────────────
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ══════════════════════════════════════════════════════════
// POST /api/auth/send-otp
// ══════════════════════════════════════════════════════════
router.post(
  '/send-otp',
  authLimiter,
  [
    body('email')
      .trim()
      .notEmpty().withMessage('Email is required')
      .isEmail().withMessage('Please provide a valid email address')
      .normalizeEmail(),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const { email } = req.body;
      const otpCode = generateOTP();

      // Delete existing OTPs for this email to prevent spam
      await OTP.deleteMany({ email });

      // Save new OTP
      await OTP.create({ email, otp: otpCode });

      // Send email
      await sendEmail({
        to: email,
        type: 'otp',
        otp: otpCode,
      });

      res.status(200).json({
        success: true,
        message: 'OTP sent successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// POST /api/auth/verify-otp
// ══════════════════════════════════════════════════════════
router.post(
  '/verify-otp',
  authLimiter,
  [
    body('email').trim().isEmail().normalizeEmail(),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const { email, otp } = req.body;

      // Find OTP
      const otpRecord = await OTP.findOne({ email, otp });
      if (!otpRecord) {
        return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
      }

      // Check if user exists
      const user = await User.findOne({ email });
      if (!user) {
        // Valid OTP, but new user -> prompt for registration details
        return res.status(200).json({
          success: true,
          isNewUser: true,
          message: 'OTP verified. Please complete registration.',
        });
      }

      // Valid OTP, existing user -> login
      await OTP.deleteOne({ _id: otpRecord._id });
      user.lastLogin = new Date();
      await user.save({ validateBeforeSave: false });

      sendTokenResponse(user, 200, res);
    } catch (error) {
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// POST /api/auth/register-otp
// ══════════════════════════════════════════════════════════
router.post(
  '/register-otp',
  authLimiter,
  [
    body('name').trim().notEmpty().isLength({ min: 2, max: 100 }),
    body('email').trim().isEmail().normalizeEmail(),
    body('mobile').trim().matches(/^[6-9]\d{9}$/).withMessage('Valid Indian mobile required'),
    body('otp').trim().isLength({ min: 6, max: 6 }),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const { name, email, mobile, otp } = req.body;

      const otpRecord = await OTP.findOne({ email, otp });
      if (!otpRecord) {
        return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
      }

      const existingMobile = await User.findOne({ mobile });
      if (existingMobile) {
        return res.status(409).json({ success: false, message: 'Mobile number already in use' });
      }

      const user = await User.create({
        name,
        email,
        mobile,
        isVerified: true,
      });

      await OTP.deleteOne({ _id: otpRecord._id });

      sendEmail({
        to: user.email,
        type: 'welcome',
        user: { name: user.name, email: user.email },
      });

      sendTokenResponse(user, 201, res);
    } catch (error) {
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// POST /api/auth/register
// ══════════════════════════════════════════════════════════
router.post(
  '/register',
  authLimiter,
  [
    body('name')
      .trim()
      .notEmpty().withMessage('Name is required')
      .isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),

    body('email')
      .trim()
      .notEmpty().withMessage('Email is required')
      .isEmail().withMessage('Please provide a valid email address')
      .normalizeEmail(),

    body('mobile')
      .trim()
      .notEmpty().withMessage('Mobile number is required')
      .matches(/^[6-9]\d{9}$/).withMessage('Please provide a valid 10-digit Indian mobile number'),

    body('password')
      .notEmpty().withMessage('Password is required')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  ],
  async (req, res, next) => {
    try {
      // Validate input
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const { name, email, mobile, password } = req.body;

      // Check if email or mobile already exists
      const existingEmail = await User.findOne({ email: email.toLowerCase() });
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: 'An account with this email address already exists',
        });
      }

      const existingMobile = await User.findOne({ mobile });
      if (existingMobile) {
        return res.status(409).json({
          success: false,
          message: 'An account with this mobile number already exists',
        });
      }

      // Create user (password hashed in pre-save hook)
      const user = await User.create({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        mobile: mobile.trim(),
        password,
      });

      // Send welcome email (non-blocking - failure won't affect registration)
      sendEmail({
        to: user.email,
        type: 'welcome',
        user: { name: user.name, email: user.email },
      });

      // Return token
      sendTokenResponse(user, 201, res);

    } catch (error) {
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// POST /api/auth/login
// Login by email OR mobile number
// ══════════════════════════════════════════════════════════
router.post(
  '/login',
  authLimiter,
  [
    body('emailOrMobile')
      .trim()
      .notEmpty().withMessage('Email or mobile number is required'),

    body('password')
      .notEmpty().withMessage('Password is required'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const { emailOrMobile, password } = req.body;

      // Find user by email or mobile (static method on User model)
      // .select('+password') because password is select:false by default
      const user = await User.findByEmailOrMobile(emailOrMobile);

      if (!user) {
        // Use same generic message for both "user not found" and "wrong password"
        // to prevent user enumeration attacks
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. Please check your email/mobile and password.',
        });
      }

      // Check if account is blocked
      if (user.isBlocked) {
        return res.status(403).json({
          success: false,
          message: 'Your account has been suspended. Please contact support.',
        });
      }

      // Verify password
      const isPasswordMatch = await user.matchPassword(password);
      if (!isPasswordMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. Please check your email/mobile and password.',
        });
      }

      // Update last login timestamp
      user.lastLogin = new Date();
      await user.save({ validateBeforeSave: false });

      sendTokenResponse(user, 200, res);

    } catch (error) {
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// GET /api/auth/profile  (Protected)
// ══════════════════════════════════════════════════════════
router.get('/profile', protect, async (req, res, next) => {
  try {
    // req.user is already populated by the protect middleware
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      user,
    });

  } catch (error) {
    next(error);
  }
});

// ══════════════════════════════════════════════════════════
// PUT /api/auth/profile  (Protected)
// Update name and/or addresses
// ══════════════════════════════════════════════════════════
router.put(
  '/profile',
  protect,
  [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),

    body('addresses')
      .optional()
      .isArray({ max: 5 }).withMessage('You can save a maximum of 5 addresses'),

    body('addresses.*.fullName')
      .optional()
      .notEmpty().withMessage('Address full name is required'),

    body('addresses.*.phone')
      .optional()
      .matches(/^[6-9]\d{9}$/).withMessage('Invalid phone number in address'),

    body('addresses.*.pincode')
      .optional()
      .matches(/^[1-9][0-9]{5}$/).withMessage('Invalid pincode in address'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const user = await User.findById(req.user._id);

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Only update fields that were provided
      if (req.body.name !== undefined) {
        user.name = req.body.name.trim();
      }

      if (req.body.addresses !== undefined) {
        user.addresses = req.body.addresses;
      }

      await user.save({ validateBeforeSave: true });

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        user,
      });

    } catch (error) {
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// PUT /api/auth/change-password  (Protected)
// ══════════════════════════════════════════════════════════
router.put(
  '/change-password',
  protect,
  [
    body('currentPassword')
      .notEmpty().withMessage('Current password is required'),

    body('newPassword')
      .notEmpty().withMessage('New password is required')
      .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain uppercase, lowercase, and a number'),

    body('confirmPassword')
      .custom((value, { req }) => {
        if (value !== req.body.newPassword) {
          throw new Error('New password and confirm password do not match');
        }
        return true;
      }),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      // Need to explicitly select password field
      const user = await User.findById(req.user._id).select('+password');

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Verify current password
      const isMatch = await user.matchPassword(req.body.currentPassword);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect',
        });
      }

      // Prevent using the same password
      const isSamePassword = await user.matchPassword(req.body.newPassword);
      if (isSamePassword) {
        return res.status(400).json({
          success: false,
          message: 'New password must be different from current password',
        });
      }

      // Set new password (will be hashed by pre-save hook)
      user.password = req.body.newPassword;
      await user.save();

      res.status(200).json({
        success: true,
        message: 'Password changed successfully. Please log in again with your new password.',
      });

    } catch (error) {
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// GET /api/auth/orders  (Protected)
// Get logged-in user's order history
// ══════════════════════════════════════════════════════════
router.get('/orders', protect, async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(20, parseInt(req.query.limit) || 10);
    const skip  = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('items.product', 'name images slug'),
      Order.countDocuments({ user: req.user._id }),
    ]);

    res.status(200).json({
      success: true,
      count:   orders.length,
      total,
      page,
      pages:   Math.ceil(total / limit),
      orders,
    });

  } catch (error) {
    next(error);
  }
});

// ══════════════════════════════════════════════════════════
// POST /api/auth/logout  (Protected)
// Clear the httpOnly cookie
// ══════════════════════════════════════════════════════════
router.post('/logout', protect, (req, res) => {
  res.cookie('seawave_token', '', {
    httpOnly: true,
    expires: new Date(0),  // Immediately expire the cookie
  });

  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});

module.exports = router;
