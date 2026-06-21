/**
 * models/Product.js - Wooden Busy Board Product Model
 * Represents products sold on Seawave Toys platform.
 *
 * Stock Logic (IMPORTANT):
 * - stock field = current available units for purchase
 * - sold field  = total units ever delivered (permanently increases)
 * - When order is CREATED: stock is reduced (to prevent overselling)
 * - When order is DELIVERED: sold count increases
 * - When order is RETURNED: stock is NOT restored (per business requirement)
 */

'use strict';

const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Product name cannot exceed 200 characters'],
      index: 'text',   // Enable text search on name
    },

    description: {
      type: String,
      required: [true, 'Product description is required'],
      trim: true,
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
    },

    // Selling price (what customer pays)
    price: {
      type: Number,
      required: [true, 'Product price is required'],
      min: [0, 'Price cannot be negative'],
    },

    // MRP / Original price (shown as crossed out for discount display)
    mrp: {
      type: Number,
      required: [true, 'MRP is required'],
      min: [0, 'MRP cannot be negative'],
      validate: {
        validator: function (v) {
          // MRP should be >= selling price
          return v >= this.price;
        },
        message: 'MRP must be greater than or equal to selling price',
      },
    },

    // Reference to Category model
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Product category is required'],
      index: true,
    },

    // Array of image URLs (uploaded files or external URLs)
    images: {
      type: [String],
      default: [],
      validate: {
        validator: function (arr) {
          return arr.length <= 10;  // Max 10 images per product
        },
        message: 'A product can have a maximum of 10 images',
      },
    },

    // Current available stock (decreases when orders are placed)
    stock: {
      type: Number,
      required: [true, 'Stock quantity is required'],
      min: [0, 'Stock cannot be negative'],
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: 'Stock must be a whole number',
      },
    },

    // Total units ever successfully delivered (never decreases)
    sold: {
      type: Number,
      default: 0,
      min: [0, 'Sold count cannot be negative'],
    },

    // Whether product is visible on storefront
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Search and filter tags (e.g., ['educational', 'wooden', 'handmade'])
    tags: {
      type: [String],
      default: [],
    },

    // Target age group (e.g., '1-3 years', '3-5 years', '5+ years')
    ageGroup: {
      type: String,
      trim: true,
      maxlength: [50, 'Age group cannot exceed 50 characters'],
      default: '1-3 years',
    },

    // Physical dimensions (for shipping calculation and customer info)
    dimensions: {
      length: { type: Number, min: 0 },  // cm
      width:  { type: Number, min: 0 },  // cm
      height: { type: Number, min: 0 },  // cm
    },

    // Weight in grams (for shipping calculation)
    weight: {
      type: Number,
      min: [0, 'Weight cannot be negative'],
      default: 0,
    },

    // SEO-friendly URL slug
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    // Featured flag for homepage display
    isFeatured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,   // Include virtual fields in JSON output
      transform: function (doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ─── VIRTUAL: Discount percentage ─────────────────────────
productSchema.virtual('discountPercent').get(function () {
  if (this.mrp > 0 && this.mrp > this.price) {
    return Math.round(((this.mrp - this.price) / this.mrp) * 100);
  }
  return 0;
});

// ─── VIRTUAL: Is in stock ─────────────────────────────────
productSchema.virtual('inStock').get(function () {
  return this.stock > 0;
});

// ─── INDEXES ─────────────────────────────────────────────
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ price: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ sold: -1 });

// ─── PRE-SAVE: Auto-generate slug ─────────────────────────
productSchema.pre('save', async function (next) {
  if (this.isModified('name') || !this.slug) {
    let baseSlug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');

    // Ensure slug uniqueness by appending a random suffix if needed
    let slug = baseSlug;
    const Product = mongoose.model('Product');
    const existing = await Product.findOne({ slug, _id: { $ne: this._id } });
    if (existing) {
      slug = `${baseSlug}-${Date.now().toString(36)}`;
    }
    this.slug = slug;
  }
  next();
});

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
