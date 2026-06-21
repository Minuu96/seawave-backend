/**
 * models/Category.js - Product Category Model
 * Categories for organizing Seawave Toys products.
 * Examples: Activity Boards, Montessori Boards, Travel Boards, Custom Boards
 */

'use strict';

const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      unique: true,
      trim: true,
      maxlength: [100, 'Category name cannot exceed 100 characters'],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
      default: '',
    },

    // URL-friendly identifier (e.g., "activity-boards")
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    // Category banner/thumbnail image URL or path
    image: {
      type: String,
      default: '',
    },

    // Whether this category is visible on the storefront
    isActive: {
      type: Boolean,
      default: true,
    },

    // Display order in navigation/listing
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ─── PRE-SAVE HOOK: Auto-generate slug from name ───────────
categorySchema.pre('save', function (next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')   // Remove special chars
      .replace(/\s+/g, '-')            // Replace spaces with hyphens
      .replace(/-+/g, '-');            // Collapse multiple hyphens
  }
  next();
});

// ─── STATIC METHOD: Find active categories ─────────────────
categorySchema.statics.getActiveCategories = function () {
  return this.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
};

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;
