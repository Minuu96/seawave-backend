/**
 * routes/orders.js - Customer Order Routes
 * Handles order creation, retrieval, and payment verification.
 *
 * Stock Logic (Critical):
 *   - ORDER CREATE: Stock is immediately deducted (prevents overselling)
 *   - PAYMENT VERIFY: Order confirmed, payment recorded
 *   - Status → DELIVERED (admin route): sold++ count
 *   - Status → RETURNED: NO stock restoration
 *
 * All routes are protected (require customer JWT).
 *
 * Routes:
 *   POST /api/orders/create         - Create new order, deduct stock, create Razorpay order
 *   GET  /api/orders/:id            - Get single order (owner only)
 *   POST /api/orders/verify-payment - Verify Razorpay payment signature, confirm order
 */

'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const crypto = require('crypto');
const mongoose = require('mongoose');

const Order   = require('../models/Order');
const Product = require('../models/Product');
const { protect } = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimiter');
const sendEmail = require('../utils/sendEmail');

const router = express.Router();

// All order routes require authentication
router.use(protect);

// ─── Helper: Validation error handler ────────────────────
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

// ══════════════════════════════════════════════════════════
// POST /api/orders/create
// Creates a new order after validating stock availability.
// Deducts stock immediately to prevent overselling.
// Also creates a Razorpay order for payment.
//
// Request Body:
//   items[]:
//     productId {string} - Product ObjectId
//     quantity  {number} - Quantity to purchase
//   shippingAddress:
//     fullName, phone, addressLine1, addressLine2?, city, state, pincode
//   razorpayOrderId {string} - Razorpay order ID from /api/payment/create-order
// ══════════════════════════════════════════════════════════
router.post(
  '/create',
  paymentLimiter,
  [
    body('items')
      .isArray({ min: 1 }).withMessage('Order must have at least one item'),
    body('items.*.productId')
      .notEmpty().withMessage('Product ID is required for each item')
      .isMongoId().withMessage('Invalid product ID'),
    body('items.*.quantity')
      .isInt({ min: 1, max: 100 }).withMessage('Quantity must be between 1 and 100'),
    body('shippingAddress.fullName')
      .trim().notEmpty().withMessage('Recipient full name is required'),
    body('shippingAddress.phone')
      .trim().matches(/^[6-9]\d{9}$/).withMessage('Valid 10-digit mobile number required'),
    body('shippingAddress.addressLine1')
      .trim().notEmpty().withMessage('Address line 1 is required'),
    body('shippingAddress.city')
      .trim().notEmpty().withMessage('City is required'),
    body('shippingAddress.state')
      .trim().notEmpty().withMessage('State is required'),
    body('shippingAddress.pincode')
      .trim().matches(/^[1-9][0-9]{5}$/).withMessage('Valid 6-digit pincode required'),
    body('razorpayOrderId')
      .trim().notEmpty().withMessage('Razorpay order ID is required'),
  ],
  async (req, res, next) => {
    // Use a mongoose session for atomic stock deduction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) {
        await session.abortTransaction();
        session.endSession();
        return;
      }

      const { items, shippingAddress, razorpayOrderId } = req.body;

      // ── Step 1: Validate and fetch all products ──────────
      const productIds = items.map((item) => item.productId);
      const products = await Product.find({
        _id: { $in: productIds },
        isActive: true,
      }).session(session);

      // Verify all requested products exist
      if (products.length !== productIds.length) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: 'One or more products in your cart are no longer available',
        });
      }

      // Create a map for quick lookup
      const productMap = {};
      products.forEach((p) => {
        productMap[p._id.toString()] = p;
      });

      // ── Step 2: Check stock for all items ────────────────
      const stockErrors = [];
      for (const item of items) {
        const product = productMap[item.productId];
        if (product.stock < item.quantity) {
          stockErrors.push({
            product: product.name,
            available: product.stock,
            requested: item.quantity,
          });
        }
      }

      if (stockErrors.length > 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: 'Insufficient stock for some items',
          stockErrors,
        });
      }

      // ── Step 3: Build order items (price snapshot) ────────
      const orderItems = items.map((item) => {
        const product = productMap[item.productId];
        return {
          product: product._id,
          name:     product.name,
          price:    product.price,
          mrp:      product.mrp,
          quantity: item.quantity,
          image:    product.images && product.images[0] ? product.images[0] : '',
        };
      });

      // ── Step 4: Calculate order totals ───────────────────
      const totalAmount = orderItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      // 18% GST on total (adjust as needed for your product category)
      const taxRate = 0.18;
      const taxAmount = parseFloat((totalAmount * taxRate).toFixed(2));
      const finalAmount = parseFloat((totalAmount + taxAmount).toFixed(2));

      // ── Step 5: Create the order document ────────────────
      const [order] = await Order.create(
        [
          {
            user:            req.user._id,
            items:           orderItems,
            shippingAddress: {
              fullName:     shippingAddress.fullName.trim(),
              phone:        shippingAddress.phone.trim(),
              addressLine1: shippingAddress.addressLine1.trim(),
              addressLine2: shippingAddress.addressLine2 ? shippingAddress.addressLine2.trim() : '',
              city:         shippingAddress.city.trim(),
              state:        shippingAddress.state.trim(),
              pincode:      shippingAddress.pincode.trim(),
            },
            paymentInfo: {
              razorpayOrderId,
              status: 'pending',
            },
            orderStatus:  'pending',
            totalAmount,
            taxAmount,
            discountAmount: 0,
            finalAmount,
            stockDeducted:  false,  // Will be set to true after stock deduction below
            statusHistory: [
              {
                status:    'pending',
                changedAt: new Date(),
                changedBy: 'system',
                note:      'Order created, awaiting payment',
              },
            ],
          },
        ],
        { session }
      );

      // ── Step 6: Deduct stock from all products ────────────
      // This is done atomically within the transaction.
      // If this fails, the order creation is also rolled back.
      for (const item of items) {
        await Product.findByIdAndUpdate(
          item.productId,
          { $inc: { stock: -item.quantity } },
          { session, new: true }
        );
      }

      // Mark stock as deducted
      order.stockDeducted = true;
      await order.save({ session });

      // ── Step 7: Commit transaction ────────────────────────
      await session.commitTransaction();
      session.endSession();

      // ── Step 8: Send confirmation email (non-blocking) ───
      sendEmail({
        to:    req.user.email,
        type:  'orderConfirmation',
        user:  { name: req.user.name, email: req.user.email },
        order: order,
      });

      res.status(201).json({
        success: true,
        message: 'Order created successfully. Please complete the payment.',
        order: {
          _id:            order._id,
          orderNumber:    `SW-${new Date().getFullYear()}-${order._id.toString().slice(-6).toUpperCase()}`,
          razorpayOrderId,
          finalAmount:    order.finalAmount,
          orderStatus:    order.orderStatus,
          items:          order.items,
          shippingAddress: order.shippingAddress,
        },
      });

    } catch (error) {
      // Roll back ALL database changes if anything fails
      await session.abortTransaction();
      session.endSession();
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// POST /api/orders/verify-payment
// IMPORTANT: This route MUST be before /:id
// Verifies Razorpay payment signature after customer pays.
// Confirms the order and updates payment status.
//
// Request Body:
//   orderId           {string} - Our Order _id (MongoDB)
//   razorpayOrderId   {string} - Razorpay order ID
//   razorpayPaymentId {string} - Razorpay payment ID
//   razorpaySignature {string} - HMAC signature from Razorpay
// ══════════════════════════════════════════════════════════
router.post(
  '/verify-payment',
  paymentLimiter,
  [
    body('orderId').isMongoId().withMessage('Invalid order ID'),
    body('razorpayOrderId').trim().notEmpty().withMessage('Razorpay order ID is required'),
    body('razorpayPaymentId').trim().notEmpty().withMessage('Razorpay payment ID is required'),
    body('razorpaySignature').trim().notEmpty().withMessage('Razorpay signature is required'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

      // ── Step 1: Fetch the order ──────────────────────────
      const order = await Order.findOne({
        _id: orderId,
        user: req.user._id,  // Ensure order belongs to this user
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found',
        });
      }

      // Prevent processing already-paid orders
      if (order.paymentInfo.status === 'paid') {
        return res.status(400).json({
          success: false,
          message: 'Payment has already been verified for this order',
        });
      }

      // ── Step 2: Verify Razorpay HMAC signature ───────────
      // Signature = HMAC-SHA256(razorpayOrderId + "|" + razorpayPaymentId, KEY_SECRET)
      const generatedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      if (generatedSignature !== razorpaySignature) {
        // Payment signature mismatch - possible fraud attempt
        console.warn(
          `[Payment] ⚠️  Signature mismatch for order ${orderId} by user ${req.user._id}`
        );

        // Update order to reflect failed payment
        order.paymentInfo.status = 'failed';
        order.orderStatus = 'cancelled';
        order.statusHistory.push({
          status:    'cancelled',
          changedAt: new Date(),
          changedBy: 'system',
          note:      'Payment verification failed - invalid signature',
        });
        await order.save();

        return res.status(400).json({
          success: false,
          message: 'Payment verification failed. Invalid signature.',
        });
      }

      // ── Step 3: Update order with payment confirmation ────
      order.paymentInfo.razorpayPaymentId = razorpayPaymentId;
      order.paymentInfo.razorpaySignature = razorpaySignature;
      order.paymentInfo.status = 'paid';
      order.paymentInfo.paidAt = new Date();
      order.orderStatus = 'confirmed';

      order.statusHistory.push({
        status:    'confirmed',
        changedAt: new Date(),
        changedBy: 'system',
        note:      `Payment successful. Razorpay Payment ID: ${razorpayPaymentId}`,
      });

      await order.save();

      res.status(200).json({
        success: true,
        message: 'Payment verified successfully! Your order is confirmed.',
        order: {
          _id:          order._id,
          orderNumber:  `SW-${new Date(order.createdAt).getFullYear()}-${order._id.toString().slice(-6).toUpperCase()}`,
          orderStatus:  order.orderStatus,
          paymentStatus: order.paymentInfo.status,
          finalAmount:  order.finalAmount,
        },
      });

    } catch (error) {
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// GET /api/orders/:id
// Get single order details (only for the order's owner)
// ══════════════════════════════════════════════════════════
router.get(
  '/:id',
  [
    param('id').isMongoId().withMessage('Invalid order ID'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const order = await Order.findOne({
        _id:  req.params.id,
        user: req.user._id,  // Security: users can only view their own orders
      }).populate('items.product', 'name images slug isActive');

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found',
        });
      }

      res.status(200).json({
        success: true,
        order,
      });

    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
