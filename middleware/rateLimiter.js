/**
 * middleware/rateLimiter.js - Express Rate Limiting Configuration
 * Provides multiple rate limiters for different route categories.
 * Protects against brute force, DDoS, and API abuse.
 *
 * Limits:
 *   - General API     : 100 requests per 15 minutes (per IP)
 *   - Auth routes     : 5 requests per 15 minutes (per IP) - strict for login/register
 *   - Payment routes  : 10 requests per 15 minutes (per IP) - moderate for payment flows
 */

'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Custom handler for when rate limit is exceeded.
 * Returns a JSON response instead of the default HTML message.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @param {Object} options - Rate limiter options
 */
const rateLimitExceededHandler = (req, res, next, options) => {
  res.status(options.statusCode).json({
    success: false,
    message: options.message,
    retryAfter: Math.ceil(options.windowMs / 1000 / 60), // minutes until reset
  });
};

/**
 * General API rate limiter.
 * Applied to all /api routes as a baseline protection.
 * 100 requests per 15-minute window per IP.
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes in milliseconds
  max: 100,                    // Maximum requests per window
  message: 'Too many requests from this IP. Please try again after 15 minutes.',
  statusCode: 429,
  standardHeaders: true,       // Send RateLimit-* headers (RFC 6585)
  legacyHeaders: false,        // Disable X-RateLimit-* headers (deprecated)
  handler: rateLimitExceededHandler,
  // Skip rate limiting for trusted internal services (add IPs as needed)
  skip: (req) => {
    const trustedIPs = process.env.TRUSTED_IPS ? process.env.TRUSTED_IPS.split(',') : [];
    return trustedIPs.includes(req.ip);
  },
});

/**
 * Strict auth rate limiter.
 * Applied to login and registration endpoints to prevent brute force attacks.
 * Only 5 requests per 15-minute window per IP.
 *
 * This is deliberately strict to prevent:
 * - Credential stuffing attacks
 * - Brute force password guessing
 * - Account enumeration via registration
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 5,                      // 5 attempts per window
  message: 'Too many login attempts from this IP. Please wait 15 minutes before trying again.',
  statusCode: 429,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitExceededHandler,
  // Reset limit on successful login (don't penalize successful users)
  skipSuccessfulRequests: false,
});

/**
 * Payment rate limiter.
 * Applied to payment creation and verification endpoints.
 * Moderate limit of 10 requests per 15 minutes.
 * Prevents automated payment manipulation attempts.
 */
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 10,                     // 10 payment operations per window
  message: 'Too many payment requests. Please wait 15 minutes before trying again.',
  statusCode: 429,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitExceededHandler,
});

/**
 * Admin rate limiter.
 * Slightly more lenient than auth limiter since admins perform many operations,
 * but still protected against scripted attacks.
 * 20 requests per 15-minute window.
 */
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 20,                     // 20 attempts per window
  message: 'Too many admin login attempts. Please wait 15 minutes.',
  statusCode: 429,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitExceededHandler,
});

module.exports = {
  generalLimiter,
  authLimiter,
  paymentLimiter,
  adminLimiter,
};
