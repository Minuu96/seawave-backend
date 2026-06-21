/**
 * server.js - Main Entry Point for Seawave Toys Backend API
 * Express application configured with all security middleware,
 * route handlers, and global error handling.
 */

'use strict';

// Load environment variables FIRST before any other imports
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const path = require('path');

// Internal imports
const connectDB = require('./config/db');
const { generalLimiter } = require('./middleware/rateLimiter');

// Route imports
const authRoutes    = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes   = require('./routes/orders');
const adminRoutes   = require('./routes/admin');
const paymentRoutes = require('./routes/payment');

// Models needed for standalone routes
const Category = require('./models/Category');

// Initialize Express app
const app = express();

// ─────────────────────────────────────────────
// 1. CONNECT TO DATABASE
// ─────────────────────────────────────────────
connectDB();

// ─────────────────────────────────────────────
// 2. SECURITY MIDDLEWARE
// ─────────────────────────────────────────────

// Set security HTTP headers (Content-Security-Policy, X-Frame-Options, etc.)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow images to be served cross-origin
}));

// Enable CORS - only allow the frontend origin
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'http://localhost:3000',  // Allow alternate dev port
    ];
    // Allow requests with no origin (mobile apps, curl, Postman in dev)
    if (!origin && process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    // Allow local network IP addresses (192.168.*, 10.*, 172.16-31.*) for mobile testing
    if (origin && (origin.startsWith('http://192.168.') || origin.startsWith('http://10.') || origin.startsWith('http://172.'))) {
      return callback(null, true);
    }
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy: Origin ${origin} not allowed`));
    }
  },
  credentials: true,                   // Allow cookies to be sent
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));   // Handle pre-flight requests

// Sanitize data against NoSQL query injection (e.g., { "$gt": "" })
app.use(mongoSanitize());

// Sanitize data against XSS attacks (strip HTML tags from input)
app.use(xss());

// Prevent HTTP Parameter Pollution attacks
app.use(hpp({
  whitelist: ['sort', 'fields', 'page', 'limit', 'category', 'tags', 'ageGroup'], // Allow duplicate query params for these
}));

// ─────────────────────────────────────────────
// 3. BODY PARSING MIDDLEWARE
// ─────────────────────────────────────────────

// Parse JSON bodies (max 10mb to allow base64 images if needed)
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Parse cookies
app.use(cookieParser());

// ─────────────────────────────────────────────
// 4. LOGGING
// ─────────────────────────────────────────────

// HTTP request logger - 'combined' in production, 'dev' in development
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// ─────────────────────────────────────────────
// 5. GENERAL RATE LIMITING
// ─────────────────────────────────────────────

// Apply general rate limiter to all routes
app.use('/api', generalLimiter);

// ─────────────────────────────────────────────
// 6. STATIC FILES (for uploaded product images)
// ─────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─────────────────────────────────────────────
// 7. HEALTH CHECK ENDPOINT
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Seawave Toys API is running',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
// 8. API ROUTES
// ─────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payment', paymentRoutes);

// ── Standalone Categories Route ──────────────────────────
// GET /api/categories - Public endpoint for navigation/filtering
app.get('/api/categories', async (req, res, next) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    res.status(200).json({
      success: true,
      count: categories.length,
      categories,
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// 9. 404 HANDLER - for unrecognized routes
// ─────────────────────────────────────────────
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// ─────────────────────────────────────────────
// 10. GLOBAL ERROR HANDLER
// Express recognizes a 4-argument function as an error handler
// ─────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Log error stack in development
  if (process.env.NODE_ENV === 'development') {
    console.error('─── ERROR ───────────────────────────────────');
    console.error(err.stack);
    console.error('─────────────────────────────────────────────');
  } else {
    console.error(`[ERROR] ${new Date().toISOString()} - ${err.message}`);
  }

  // Handle specific error types
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Internal Server Error';

  // Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue)[0];
    message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map((e) => e.message).join(', ');
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token. Please log in again.';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired. Please log in again.';
  }

  // CORS error
  if (err.message && err.message.startsWith('CORS policy')) {
    statusCode = 403;
    message = err.message;
  }

  res.status(statusCode).json({
    success: false,
    message,
    // Include stack trace only in development mode
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ─────────────────────────────────────────────
// 11. START SERVER
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log('════════════════════════════════════════════════');
  console.log('  🌊  Seawave Toys Backend API');
  console.log('════════════════════════════════════════════════');
  console.log(`  ► Environment : ${process.env.NODE_ENV}`);
  console.log(`  ► Port        : ${PORT}`);
  console.log(`  ► API Base    : http://localhost:${PORT}/api`);
  console.log(`  ► Health      : http://localhost:${PORT}/health`);
  console.log('════════════════════════════════════════════════');
});

// Handle unhandled promise rejections (e.g., DB connection failures)
process.on('unhandledRejection', (err) => {
  console.error(`[UNHANDLED REJECTION] ${err.name}: ${err.message}`);
  // Gracefully shut down server then exit
  server.close(() => {
    console.error('Server closed due to unhandled rejection. Exiting...');
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error(`[UNCAUGHT EXCEPTION] ${err.name}: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});

// Graceful shutdown on SIGTERM (Docker/cloud environments send this)
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});

module.exports = app;
