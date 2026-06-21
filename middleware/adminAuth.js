/**
 * middleware/adminAuth.js - Admin JWT Authentication Middleware
 * Verifies JWT tokens issued specifically to admin users.
 * Uses a SEPARATE secret (ADMIN_JWT_SECRET) from customer tokens,
 * so customer tokens cannot be used to access admin routes.
 */

'use strict';

const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

/**
 * Middleware to protect all admin routes.
 * Only accepts tokens signed with ADMIN_JWT_SECRET.
 * Attaches admin document to req.admin.
 *
 * Usage: router.get('/admin/something', adminProtect, handler)
 */
const adminProtect = async (req, res, next) => {
  try {
    let token = null;

    // 1. Check Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // 2. Fallback: check admin-specific cookie
    else if (req.cookies && req.cookies.seawave_admin_token) {
      token = req.cookies.seawave_admin_token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Admin authentication required.',
      });
    }

    // Verify against ADMIN_JWT_SECRET (separate from customer secret)
    // This prevents customer tokens from being used on admin routes
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);

    // Ensure the token payload marks this as an admin token
    if (!decoded.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This token does not have admin privileges.',
      });
    }

    // Fetch admin from DB to ensure they still exist and are active
    const admin = await Admin.findById(decoded.id).select('-password');

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin account not found.',
      });
    }

    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Admin account has been deactivated.',
      });
    }

    // Attach admin to request for use in route handlers
    req.admin = admin;
    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin token. Please log in again.',
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Admin session expired. Please log in again.',
      });
    }

    next(error);
  }
};

/**
 * Role-based access control for admin routes.
 * Use after adminProtect to restrict certain actions to superadmin only.
 *
 * @param {...string} roles - Allowed roles (e.g., 'superadmin', 'admin')
 * Example: router.delete('/admin/users/:id', adminProtect, requireRole('superadmin'), handler)
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}`,
      });
    }
    next();
  };
};

module.exports = { adminProtect, requireRole };
