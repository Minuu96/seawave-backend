/**
 * routes/payment.js - Razorpay Payment Routes
 * Handles creation of Razorpay payment orders and payment verification.
 *
 * Note: Razorpay keys are stored in ENV variables (not hardcoded).
 * The frontend uses Razorpay checkout.js with the key_id to show the payment UI.
 *
 * Routes:
 *   POST /api/payment/create-order - Create Razorpay order (returns order_id)
 *   POST /api/payment/verify       - Verify payment signature (fallback endpoint)
 */

'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const Razorpay = require('razorpay');

const { protect } = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// ─── Initialize Razorpay instance ─────────────────────────
// Keys come from environment variables (never hardcoded)
let razorpayInstance = null;

const getRazorpayInstance = () => {
  if (!razorpayInstance) {
    if (
      !process.env.RAZORPAY_KEY_ID ||
      process.env.RAZORPAY_KEY_ID === 'ADD_RAZORPAY_KEY_ID_HERE' ||
      !process.env.RAZORPAY_KEY_SECRET ||
      process.env.RAZORPAY_KEY_SECRET === 'ADD_RAZORPAY_KEY_SECRET_HERE'
    ) {
      throw new Error(
        'Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env'
      );
    }

    razorpayInstance = new Razorpay({
      key_id:     process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayInstance;
};

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
// POST /api/payment/create-order
// Creates a Razorpay order.
// The frontend uses the returned order_id with Razorpay checkout.js.
//
// Request Body:
//   amount   {number} - Amount in RUPEES (will be converted to paise)
//   currency {string} - Currency code (default: 'INR')
//   receipt  {string} - Optional receipt identifier
//
// Response:
//   razorpayOrderId {string} - Razorpay order ID to use in frontend
//   amount          {number} - Amount in paise
//   currency        {string}
//   key             {string} - Razorpay key_id for frontend checkout
// ══════════════════════════════════════════════════════════
router.post(
  '/create-order',
  protect,
  paymentLimiter,
  [
    body('amount')
      .isFloat({ min: 1 }).withMessage('Amount must be a positive number (in rupees)'),
    body('currency')
      .optional()
      .isIn(['INR']).withMessage('Only INR currency is supported'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const razorpay = getRazorpayInstance();

      const { amount, currency = 'INR', receipt } = req.body;

      // Razorpay requires amount in paise (1 INR = 100 paise)
      const amountInPaise = Math.round(parseFloat(amount) * 100);

      // Minimum transaction: ₹1 (100 paise)
      if (amountInPaise < 100) {
        return res.status(400).json({
          success: false,
          message: 'Minimum payment amount is ₹1',
        });
      }

      const options = {
        amount:   amountInPaise,
        currency,
        receipt:  receipt || `rcpt_${req.user._id.toString().slice(-8)}_${Date.now()}`,
        notes: {
          userId:      req.user._id.toString(),
          userEmail:   req.user.email,
          platform:    'seawave-toys-web',
        },
      };

      const razorpayOrder = await razorpay.orders.create(options);

      res.status(201).json({
        success:        true,
        razorpayOrderId: razorpayOrder.id,
        amount:          razorpayOrder.amount,           // In paise
        amountInRupees:  razorpayOrder.amount / 100,    // In rupees
        currency:        razorpayOrder.currency,
        // Send key_id to frontend for Razorpay checkout initialization
        key:             process.env.RAZORPAY_KEY_ID,
      });

    } catch (error) {
      // Handle Razorpay-specific errors
      if (error.message && error.message.includes('Razorpay credentials not configured')) {
        return res.status(503).json({
          success: false,
          message: 'Payment service is not configured. Please contact support.',
        });
      }

      if (error.statusCode) {
        // Razorpay API error
        return res.status(502).json({
          success: false,
          message: 'Payment gateway error. Please try again.',
          razorpayError: process.env.NODE_ENV === 'development' ? error.error : undefined,
        });
      }

      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// POST /api/payment/verify
// Standalone payment verification endpoint.
// Also see: POST /api/orders/verify-payment for the main flow
// (which additionally updates order status in DB).
// This endpoint is a utility for manual verification if needed.
//
// Request Body:
//   razorpayOrderId   {string} - Razorpay order ID
//   razorpayPaymentId {string} - Razorpay payment ID
//   razorpaySignature {string} - HMAC signature from Razorpay webhook/callback
// ══════════════════════════════════════════════════════════
router.post(
  '/verify',
  protect,
  paymentLimiter,
  [
    body('razorpayOrderId').trim().notEmpty().withMessage('Razorpay order ID is required'),
    body('razorpayPaymentId').trim().notEmpty().withMessage('Razorpay payment ID is required'),
    body('razorpaySignature').trim().notEmpty().withMessage('Razorpay signature is required'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

      if (
        !process.env.RAZORPAY_KEY_SECRET ||
        process.env.RAZORPAY_KEY_SECRET === 'ADD_RAZORPAY_KEY_SECRET_HERE'
      ) {
        return res.status(503).json({
          success: false,
          message: 'Payment verification service is not configured.',
        });
      }

      // Generate expected signature
      const generatedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      const isValid = generatedSignature === razorpaySignature;

      res.status(200).json({
        success:   isValid,
        verified:  isValid,
        message:   isValid ? 'Payment signature is valid' : 'Payment signature verification failed',
      });

    } catch (error) {
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// GET /api/payment/key
// Returns the Razorpay publishable key_id for frontend use
// ══════════════════════════════════════════════════════════
router.get('/key', protect, (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID;

  if (!keyId || keyId === 'ADD_RAZORPAY_KEY_ID_HERE') {
    return res.status(503).json({
      success: false,
      message: 'Payment gateway is not configured.',
    });
  }

  res.status(200).json({
    success: true,
    key: keyId,
  });
});

module.exports = router;
