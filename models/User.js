/**
 * models/User.js - Customer User Model
 * Represents shoppers/customers of Seawave Toys.
 *
 * Features:
 * - Login by email OR mobile number
 * - Password hashing with bcrypt (12 rounds)
 * - JWT token generation for customer auth
 * - Multiple saved addresses support
 * - Account blocking by admin
 */

'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ─── Address Sub-Schema ────────────────────────────────────
const addressSchema = new mongoose.Schema({
  label: {
    type: String,
    trim: true,
    default: 'Home',      // Home, Work, Other
    maxlength: [30, 'Address label cannot exceed 30 characters'],
  },
  fullName: {
    type: String,
    required: [true, 'Full name is required for address'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters'],
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required for address'],
    trim: true,
    match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit Indian mobile number'],
  },
  addressLine1: {
    type: String,
    required: [true, 'Address line 1 is required'],
    trim: true,
    maxlength: [200, 'Address line 1 cannot exceed 200 characters'],
  },
  addressLine2: {
    type: String,
    trim: true,
    maxlength: [200, 'Address line 2 cannot exceed 200 characters'],
  },
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true,
    maxlength: [100, 'City name cannot exceed 100 characters'],
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true,
    maxlength: [100, 'State name cannot exceed 100 characters'],
  },
  pincode: {
    type: String,
    required: [true, 'Pincode is required'],
    trim: true,
    match: [/^[1-9][0-9]{5}$/, 'Please provide a valid 6-digit pincode'],
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
}, { _id: true });

// ─── Main User Schema ──────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },

    email: {
      type: String,
      required: [true, 'Email address is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/,
        'Please provide a valid email address',
      ],
      index: true,
    },

    mobile: {
      type: String,
      required: [true, 'Mobile number is required'],
      unique: true,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit Indian mobile number'],
      index: true,
    },

    password: {
      type: String,
      minlength: [8, 'Password must be at least 8 characters'],
      // Never return password in queries by default
      select: false,
    },

    // Array of saved delivery addresses
    addresses: {
      type: [addressSchema],
      default: [],
      validate: {
        validator: function (arr) {
          return arr.length <= 5; // Maximum 5 saved addresses per user
        },
        message: 'You can save a maximum of 5 addresses',
      },
    },

    // Email verification (can be used for email OTP flows later)
    isVerified: {
      type: Boolean,
      default: false,
    },

    // Admin can block users who violate ToS
    isBlocked: {
      type: Boolean,
      default: false,
    },

    // Track last login for security auditing
    lastLogin: {
      type: Date,
    },

    // Password reset token (for forgot-password flow)
    passwordResetToken: {
      type: String,
      select: false,
    },
    passwordResetExpiry: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,  // Adds createdAt and updatedAt automatically
    toJSON: {
      // Remove sensitive fields when converting to JSON
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpiry;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ─── INDEXES ──────────────────────────────────────────────
// Compound text index for potential future search
userSchema.index({ name: 'text', email: 'text' });

// ─── PRE-SAVE HOOK: Hash password before saving ────────────
userSchema.pre('save', async function (next) {
  // Only hash if password field was modified (not on other updates)
  if (!this.isModified('password')) {
    return next();
  }

  try {
    // 12 salt rounds: strong security (higher = slower = better protection)
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// ─── PRE-SAVE HOOK: Ensure only one default address ────────
userSchema.pre('save', function (next) {
  if (this.isModified('addresses') && this.addresses.length > 0) {
    const defaultAddresses = this.addresses.filter((addr) => addr.isDefault);

    if (defaultAddresses.length === 0) {
      // If no default is set, make the first address the default
      this.addresses[0].isDefault = true;
    } else if (defaultAddresses.length > 1) {
      // If multiple defaults, keep only the last one set as default
      this.addresses.forEach((addr, index) => {
        addr.isDefault = index === this.addresses.length - 1 && addr.isDefault;
      });
    }
  }
  next();
});

// ─── INSTANCE METHOD: Compare entered password with hash ───
/**
 * Compares a plain text password with the stored bcrypt hash.
 * @param {string} enteredPassword - The password provided by the user at login
 * @returns {Promise<boolean>} True if passwords match
 */
userSchema.methods.matchPassword = async function (enteredPassword) {
  // 'this.password' is not selected by default. Must use User.findOne().select('+password')
  return await bcrypt.compare(enteredPassword, this.password);
};

// ─── INSTANCE METHOD: Generate customer JWT token ─────────
/**
 * Generates a signed JWT token for the customer.
 * @returns {string} Signed JWT token
 */
userSchema.methods.generateAuthToken = function () {
  return jwt.sign(
    {
      id: this._id,
      email: this.email,
      name: this.name,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRE || '7d',
      issuer: 'seawave-toys-api',
      audience: 'seawave-toys-customer',
    }
  );
};

// ─── STATIC METHOD: Find user by email or mobile ──────────
/**
 * Finds a user by either their email address or mobile number.
 * Used for flexible login (user can enter either).
 *
 * @param {string} emailOrMobile - Email or 10-digit mobile number
 * @returns {Promise<User|null>} User document with password field included
 */
userSchema.statics.findByEmailOrMobile = function (emailOrMobile) {
  const isEmail = emailOrMobile.includes('@');
  const query = isEmail
    ? { email: emailOrMobile.toLowerCase().trim() }
    : { mobile: emailOrMobile.trim() };

  return this.findOne(query).select('+password');
};

const User = mongoose.model('User', userSchema);

module.exports = User;
