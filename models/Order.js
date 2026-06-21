/**
 * models/Order.js - Customer Order Model
 * Represents a purchase made on Seawave Toys platform.
 *
 * Order Status Flow:
 *   pending → confirmed → processing → shipped → delivered
 *                                              ↘ returned (terminal, no stock restore)
 *
 * Payment: Razorpay only (no COD)
 *
 * Stock Logic:
 *   - Stock deducted at ORDER CREATE time (prevents overselling)
 *   - When status → 'delivered': product.sold++ (permanent, cumulative)
 *   - When status → 'returned': NO stock restoration (business decision)
 */

'use strict';

const mongoose = require('mongoose');

// ─── Order Item Sub-Schema ────────────────────────────────
// Snapshot of product at time of purchase (price may change later)
const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Product reference is required'],
  },
  // Snapshot name (in case product name changes later)
  name: {
    type: String,
    required: [true, 'Product name snapshot is required'],
    trim: true,
  },
  // Price at time of purchase (locked)
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative'],
  },
  // MRP at time of purchase (for discount display)
  mrp: {
    type: Number,
    default: 0,
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [1, 'Quantity must be at least 1'],
    validate: {
      validator: Number.isInteger,
      message: 'Quantity must be a whole number',
    },
  },
  // Snapshot of first image (in case product images change)
  image: {
    type: String,
    default: '',
  },
}, { _id: true });

// ─── Status History Entry Sub-Schema ──────────────────────
const statusHistorySchema = new mongoose.Schema({
  status: {
    type: String,
    required: true,
  },
  changedAt: {
    type: Date,
    default: Date.now,
  },
  changedBy: {
    type: String,   // 'system', 'admin', or admin email
    default: 'system',
  },
  note: {
    type: String,
    maxlength: [500, 'Note cannot exceed 500 characters'],
    default: '',
  },
}, { _id: false });

// ─── Main Order Schema ────────────────────────────────────
const orderSchema = new mongoose.Schema(
  {
    // Reference to the customer who placed the order
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true,
    },

    // Line items (product snapshots)
    items: {
      type: [orderItemSchema],
      required: [true, 'Order must have at least one item'],
      validate: {
        validator: function (arr) {
          return arr && arr.length > 0;
        },
        message: 'Order must contain at least one item',
      },
    },

    // Delivery address (snapshot at time of order)
    shippingAddress: {
      fullName:     { type: String, required: true },
      phone:        { type: String, required: true },
      addressLine1: { type: String, required: true },
      addressLine2: { type: String, default: '' },
      city:         { type: String, required: true },
      state:        { type: String, required: true },
      pincode:      { type: String, required: true },
    },

    // Razorpay payment details
    paymentInfo: {
      // Created by Razorpay when order is initiated
      razorpayOrderId: {
        type: String,
        default: '',
        index: true,
      },
      // Returned by Razorpay after successful payment
      razorpayPaymentId: {
        type: String,
        default: '',
        index: true,
      },
      // Payment verification signature from Razorpay
      razorpaySignature: {
        type: String,
        default: '',
      },
      // Payment status: 'pending', 'paid', 'failed', 'refunded'
      status: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded'],
        default: 'pending',
      },
      // Timestamp when payment was completed
      paidAt: {
        type: Date,
      },
    },

    // Order lifecycle status
    orderStatus: {
      type: String,
      enum: {
        values: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'returned', 'cancelled'],
        message: 'Invalid order status',
      },
      default: 'pending',
      index: true,
    },

    // Financial breakdown
    // Sub-total (sum of item prices × quantities)
    totalAmount: {
      type: Number,
      required: true,
      min: [0, 'Total amount cannot be negative'],
    },
    // GST / tax amount
    taxAmount: {
      type: Number,
      default: 0,
      min: [0, 'Tax amount cannot be negative'],
    },
    // Discount applied (coupon, etc.)
    discountAmount: {
      type: Number,
      default: 0,
      min: [0, 'Discount amount cannot be negative'],
    },
    // Final amount charged to customer: totalAmount + taxAmount - discountAmount
    finalAmount: {
      type: Number,
      required: true,
      min: [0, 'Final amount cannot be negative'],
    },

    // Chronological log of status changes
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },

    // Admin notes (internal, not shown to customer)
    adminNotes: {
      type: String,
      maxlength: [1000, 'Admin notes cannot exceed 1000 characters'],
      default: '',
    },

    // Tracking number (filled when shipped)
    trackingNumber: {
      type: String,
      default: '',
    },

    // Tracking carrier
    trackingCarrier: {
      type: String,
      default: '',
    },

    // Whether stock has been deducted for this order
    // (always true after successful order creation)
    stockDeducted: {
      type: Boolean,
      default: false,
    },

    // Whether sold count has been incremented (only on delivery)
    soldIncremented: {
      type: Boolean,
      default: false,
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

// ─── INDEXES ──────────────────────────────────────────────
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ 'paymentInfo.razorpayOrderId': 1 });

// ─── VIRTUAL: Human-readable order number ─────────────────
orderSchema.virtual('orderNumber').get(function () {
  // Format: SW-2024-XXXXXX (first 6 chars of ObjectId)
  const year = this.createdAt ? this.createdAt.getFullYear() : new Date().getFullYear();
  return `SW-${year}-${this._id.toString().slice(-6).toUpperCase()}`;
});

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;
