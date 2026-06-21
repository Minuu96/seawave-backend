/**
 * middleware/auth.js - Customer JWT Authentication Middleware
 * Verifies JWT tokens issued to customers (shoppers).
 * Tokens are expected in the Authorization header as "Bearer <token>".
 * Also supports cookie-based tokens for enhanced security.
 */

'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware to protect customer routes.
 * Extracts and verifies JWT, then attaches the user document to req.user.
 *
 * Usage: router.get('/protected', protect, (req, res) => { ... })
 */
const protect = async (req, res, next) => {
  try {
    let token = null;

    // 1. Check Authorization header first (preferred for API calls)
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // 2. Fallback: check httpOnly cookie (for browser-based requests)
    else if (req.cookies && req.cookies.seawave_token) {
      token = req.cookies.seawave_token;
    }

    // No token found in any location
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No authentication token provided.',
      });
    }

    // Verify the token against the customer JWT secret
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch the user from DB to ensure they still exist and aren't blocked
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is valid but user no longer exists.',
      });
    }

    // Check if user account has been blocked by admin
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact support.',
      });
    }

    // Attach user to request object for use in route handlers
    req.user = user;
    next();

  } catch (error) {
    // jwt.verify throws errors for invalid/expired tokens
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token. Please log in again.',
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Authentication token has expired. Please log in again.',
      });
    }

    // Unexpected errors - pass to global error handler
    next(error);
  }
};

/**
 * Optional auth middleware.
 * Does NOT reject unauthenticated requests but attaches user if token is valid.
 * Useful for routes that have different behavior for logged-in vs guest users.
 */
const optionalProtect = async (req, res, next) => {
  try {
    let token = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.seawave_token) {
      token = req.cookies.seawave_token;
    }

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (user && !user.isBlocked) {
        req.user = user;
      }
    }

    next();
  } catch {
    // Silently ignore token errors for optional auth
    next();
  }
};

module.exports = { protect, optionalProtect };
