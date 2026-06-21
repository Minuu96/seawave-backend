/**
 * models/Admin.js - Admin User Model
 * Represents administrators of the Seawave Toys platform.
 * Uses a SEPARATE JWT secret from customer tokens for security isolation.
 *
 * Roles:
 *   superadmin - Full access (can manage other admins, seed data)
 *   admin      - Standard access (manage products, orders, customers)
 */

'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const adminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Admin name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },

    email: {
      type: String,
      required: [true, 'Admin email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/,
        'Please provide a valid email address',
      ],
      index: true,
    },

    password: {
      type: String,
      required: [true, 'Admin password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,  // Never return in queries
    },

    role: {
      type: String,
      enum: {
        values: ['superadmin', 'admin'],
        message: 'Role must be either superadmin or admin',
      },
      default: 'admin',
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // Track last login for security auditing
    lastLogin: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ─── PRE-SAVE HOOK: Hash password ─────────────────────────
adminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(12);  // 12 rounds same as customer
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// ─── INSTANCE METHOD: Compare password ────────────────────
/**
 * Compares entered password with the stored bcrypt hash.
 * @param {string} enteredPassword - Plain text password from login form
 * @returns {Promise<boolean>} True if passwords match
 */
adminSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// ─── INSTANCE METHOD: Generate admin JWT ──────────────────
/**
 * Generates a signed JWT token for the admin user.
 * Uses ADMIN_JWT_SECRET (different from customer JWT_SECRET).
 * Includes isAdmin: true flag to distinguish from customer tokens.
 *
 * @returns {string} Signed admin JWT token
 */
adminSchema.methods.generateAdminToken = function () {
  return jwt.sign(
    {
      id: this._id,
      email: this.email,
      name: this.name,
      role: this.role,
      isAdmin: true,          // Flag to distinguish from customer tokens
    },
    process.env.ADMIN_JWT_SECRET,   // Different secret from customer tokens!
    {
      expiresIn: process.env.ADMIN_JWT_EXPIRE || '1d',
      issuer: 'seawave-toys-api',
      audience: 'seawave-toys-admin',
    }
  );
};

const Admin = mongoose.model('Admin', adminSchema);

module.exports = Admin;
