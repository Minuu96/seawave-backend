/**
 * routes/admin.js - Admin Panel API Routes
 * All routes (except /login) are protected with adminAuth middleware.
 * Admin panel accessible via /xadmin-8823 on the frontend.
 * Backend routes are at /api/admin/*.
 *
 * Routes:
 *   POST   /api/admin/login
 *   GET    /api/admin/dashboard
 *   GET    /api/admin/products
 *   POST   /api/admin/products
 *   PUT    /api/admin/products/:id
 *   DELETE /api/admin/products/:id
 *   PUT    /api/admin/products/:id/stock
 *   GET    /api/admin/orders
 *   GET    /api/admin/orders/:id
 *   PUT    /api/admin/orders/:id/status  ← Stock logic applied here
 *   GET    /api/admin/customers
 *   PUT    /api/admin/customers/:id/block
 *   GET    /api/admin/categories
 *   POST   /api/admin/categories
 *   PUT    /api/admin/categories/:id
 *   DELETE /api/admin/categories/:id
 *   POST   /api/admin/seed
 */

'use strict';

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Admin    = require('../models/Admin');
const Product  = require('../models/Product');
const Order    = require('../models/Order');
const User     = require('../models/User');
const Category = require('../models/Category');
const { adminProtect, requireRole } = require('../middleware/adminAuth');
const { adminLimiter } = require('../middleware/rateLimiter');
const sendEmail = require('../utils/sendEmail');

const router = express.Router();

// ─── Helper: Handle validation errors ────────────────────
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
// POST /api/admin/login
// Public route — no adminProtect middleware here
// ══════════════════════════════════════════════════════════
router.post(
  '/login',
  adminLimiter,
  [
    body('email')
      .trim()
      .isEmail().withMessage('Valid email is required')
      .normalizeEmail(),
    body('password')
      .notEmpty().withMessage('Password is required'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const { email, password } = req.body;

      // Fetch admin with password (it's select:false by default)
      const admin = await Admin.findOne({ email }).select('+password');

      if (!admin) {
        return res.status(401).json({
          success: false,
          message: 'Invalid admin credentials',
        });
      }

      if (!admin.isActive) {
        return res.status(403).json({
          success: false,
          message: 'Admin account is deactivated',
        });
      }

      const isMatch = await admin.matchPassword(password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid admin credentials',
        });
      }

      // Update last login timestamp
      admin.lastLogin = new Date();
      await admin.save({ validateBeforeSave: false });

      const token = admin.generateAdminToken();

      // Also set secure httpOnly cookie for admin session
      res.cookie('seawave_admin_token', token, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge:   24 * 60 * 60 * 1000,  // 1 day
      });

      res.status(200).json({
        success: true,
        token,
        admin: {
          _id:       admin._id,
          name:      admin.name,
          email:     admin.email,
          role:      admin.role,
          lastLogin: admin.lastLogin,
        },
      });

    } catch (error) {
      next(error);
    }
  }
);

// ─── Apply adminProtect to all routes BELOW this line ────
router.use(adminProtect);

// ══════════════════════════════════════════════════════════
// POST /api/admin/logout
// ══════════════════════════════════════════════════════════
router.post('/logout', (req, res) => {
  res.cookie('seawave_admin_token', '', {
    httpOnly: true,
    expires:  new Date(0),
  });
  res.status(200).json({ success: true, message: 'Admin logged out successfully' });
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/dashboard
// Returns key business metrics for the admin dashboard
// ══════════════════════════════════════════════════════════
router.get('/dashboard', async (req, res, next) => {
  try {
    // Define "today" and "this month" boundaries
    const now         = new Date();
    const todayStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30Days  = new Date(now - 30 * 24 * 60 * 60 * 1000);

    // Run all aggregations in parallel for performance
    const [
      totalOrders,
      pendingOrders,
      deliveredOrders,
      todayOrders,
      revenueAgg,
      todayRevenueAgg,
      monthRevenueAgg,
      lowStockProducts,
      totalProducts,
      activeProducts,
      totalCustomers,
      newCustomers,
      recentOrders,
      orderStatusBreakdown,
      topProducts,
    ] = await Promise.all([
      // Total orders
      Order.countDocuments(),
      // Pending orders
      Order.countDocuments({ orderStatus: 'pending' }),
      // Delivered orders
      Order.countDocuments({ orderStatus: 'delivered' }),
      // Today's orders
      Order.countDocuments({ createdAt: { $gte: todayStart } }),

      // All-time revenue (from paid orders)
      Order.aggregate([
        { $match: { 'paymentInfo.status': 'paid' } },
        { $group: { _id: null, total: { $sum: '$finalAmount' } } },
      ]),
      // Today's revenue
      Order.aggregate([
        { $match: { 'paymentInfo.status': 'paid', createdAt: { $gte: todayStart } } },
        { $group: { _id: null, total: { $sum: '$finalAmount' } } },
      ]),
      // This month's revenue
      Order.aggregate([
        { $match: { 'paymentInfo.status': 'paid', createdAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$finalAmount' } } },
      ]),

      // Low stock products (stock <= 5)
      Product.countDocuments({ isActive: true, stock: { $lte: 5 } }),
      // Total products
      Product.countDocuments(),
      // Active products
      Product.countDocuments({ isActive: true }),

      // Total customers
      User.countDocuments(),
      // New customers (last 30 days)
      User.countDocuments({ createdAt: { $gte: last30Days } }),

      // Recent 5 orders
      Order.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('user', 'name email')
        .select('orderStatus finalAmount createdAt user items'),

      // Order status breakdown
      Order.aggregate([
        { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Top 5 best-selling products
      Product.find({ isActive: true })
        .sort({ sold: -1 })
        .limit(5)
        .select('name sold stock price images'),
    ]);

    const totalRevenue    = revenueAgg[0]?.total      || 0;
    const todayRevenue    = todayRevenueAgg[0]?.total  || 0;
    const monthRevenue    = monthRevenueAgg[0]?.total  || 0;

    res.status(200).json({
      success: true,
      dashboard: {
        orders: {
          total:     totalOrders,
          pending:   pendingOrders,
          delivered: deliveredOrders,
          today:     todayOrders,
          statusBreakdown: orderStatusBreakdown,
        },
        revenue: {
          allTime:   parseFloat(totalRevenue.toFixed(2)),
          today:     parseFloat(todayRevenue.toFixed(2)),
          thisMonth: parseFloat(monthRevenue.toFixed(2)),
        },
        products: {
          total:    totalProducts,
          active:   activeProducts,
          lowStock: lowStockProducts,
        },
        customers: {
          total: totalCustomers,
          newInLast30Days: newCustomers,
        },
        recentOrders,
        topProducts,
      },
    });

  } catch (error) {
    next(error);
  }
});

// ══════════════════════════════════════════════════════════
// ── PRODUCT MANAGEMENT ────────────────────────────────────
// ══════════════════════════════════════════════════════════

// GET /api/admin/products
router.get('/products', async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page)   || 1);
    const limit    = Math.min(50, parseInt(req.query.limit)  || 20);
    const skip     = (page - 1) * limit;
    const search   = req.query.search ? req.query.search.trim() : '';
    const category = req.query.category || '';
    const isActive = req.query.isActive !== undefined
      ? req.query.isActive === 'true'
      : undefined;

    const filter = {};
    if (search) filter.$text = { $search: search };
    if (category && mongoose.Types.ObjectId.isValid(category)) {
      filter.category = new mongoose.Types.ObjectId(category);
    }
    if (isActive !== undefined) filter.isActive = isActive;

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('category', 'name slug'),
      Product.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count:   products.length,
      total,
      page,
      pages:   Math.ceil(total / limit),
      products,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/products - Add new product
router.post(
  '/products',
  [
    body('name').trim().notEmpty().withMessage('Product name is required')
      .isLength({ max: 200 }).withMessage('Name cannot exceed 200 characters'),
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
    body('mrp').isFloat({ min: 0 }).withMessage('MRP must be a non-negative number'),
    body('category').isMongoId().withMessage('Valid category ID is required'),
    body('stock').isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
    body('ageGroup').optional().trim(),
    body('tags').optional().isArray().withMessage('Tags must be an array'),
    body('images').optional().isArray({ max: 10 }).withMessage('Maximum 10 images allowed'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const {
        name, description, price, mrp, category, images,
        stock, ageGroup, dimensions, weight, tags, isFeatured,
      } = req.body;

      // Verify category exists
      const categoryExists = await Category.findById(category);
      if (!categoryExists) {
        return res.status(404).json({
          success: false,
          message: 'Category not found',
        });
      }

      const product = await Product.create({
        name: name.trim(),
        description: description.trim(),
        price: parseFloat(price),
        mrp: parseFloat(mrp),
        category,
        images:      images      || [],
        stock:       parseInt(stock),
        ageGroup:    ageGroup    || '1-3 years',
        dimensions:  dimensions  || {},
        weight:      weight      ? parseFloat(weight) : 0,
        tags:        tags        ? tags.map((t) => t.toLowerCase().trim()) : [],
        isFeatured:  isFeatured  || false,
        isActive:    true,
      });

      await product.populate('category', 'name slug');

      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        product,
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/admin/products/:id - Edit product (all fields including stock)
router.put(
  '/products/:id',
  [
    param('id').isMongoId().withMessage('Invalid product ID'),
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('price').optional().isFloat({ min: 0 }).withMessage('Price must be non-negative'),
    body('mrp').optional().isFloat({ min: 0 }).withMessage('MRP must be non-negative'),
    body('stock').optional().isInt({ min: 0 }).withMessage('Stock must be non-negative integer'),
    body('category').optional().isMongoId().withMessage('Invalid category ID'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const product = await Product.findById(req.params.id);
      if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found' });
      }

      // Build update object from provided fields only
      const allowedFields = [
        'name', 'description', 'price', 'mrp', 'category',
        'images', 'stock', 'isActive', 'tags', 'ageGroup',
        'dimensions', 'weight', 'isFeatured',
      ];

      allowedFields.forEach((field) => {
        if (req.body[field] !== undefined) {
          if (field === 'price' || field === 'mrp' || field === 'weight') {
            product[field] = parseFloat(req.body[field]);
          } else if (field === 'stock') {
            product[field] = parseInt(req.body[field]);
          } else if (field === 'tags' && Array.isArray(req.body[field])) {
            product[field] = req.body[field].map((t) => t.toLowerCase().trim());
          } else {
            product[field] = req.body[field];
          }
        }
      });

      await product.save();
      await product.populate('category', 'name slug');

      res.status(200).json({
        success: true,
        message: 'Product updated successfully',
        product,
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/admin/products/:id - Soft delete (set isActive = false)
router.delete(
  '/products/:id',
  [param('id').isMongoId().withMessage('Invalid product ID')],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const product = await Product.findById(req.params.id);
      if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found' });
      }

      // Soft delete: set isActive = false (preserves order history references)
      product.isActive = false;
      await product.save();

      res.status(200).json({
        success: true,
        message: 'Product deactivated successfully. It will no longer appear in the store.',
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/admin/products/:id/stock - Add stock (increment only)
router.put(
  '/products/:id/stock',
  [
    param('id').isMongoId().withMessage('Invalid product ID'),
    body('quantity')
      .isInt({ min: 1 }).withMessage('Quantity to add must be a positive integer'),
    body('note')
      .optional()
      .isString()
      .isLength({ max: 200 }).withMessage('Note cannot exceed 200 characters'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const { quantity, note } = req.body;

      const product = await Product.findByIdAndUpdate(
        req.params.id,
        { $inc: { stock: parseInt(quantity) } },
        { new: true, runValidators: true }
      ).populate('category', 'name slug');

      if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found' });
      }

      console.log(
        `[Stock] Admin ${req.admin.email} added ${quantity} units to "${product.name}". ` +
        `New stock: ${product.stock}. Note: ${note || 'None'}`
      );

      res.status(200).json({
        success: true,
        message: `Stock updated. Added ${quantity} units.`,
        product: {
          _id:   product._id,
          name:  product.name,
          stock: product.stock,
          sold:  product.sold,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// ── ORDER MANAGEMENT ──────────────────────────────────────
// ══════════════════════════════════════════════════════════

// GET /api/admin/orders
router.get('/orders', async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 20);
    const skip   = (page - 1) * limit;
    const status = req.query.status || '';
    const search = req.query.search ? req.query.search.trim() : '';

    const filter = {};
    if (status && ['pending','confirmed','processing','shipped','delivered','returned','cancelled'].includes(status)) {
      filter.orderStatus = status;
    }
    if (search) {
      // Search by razorpay order ID or payment ID
      filter.$or = [
        { 'paymentInfo.razorpayOrderId':   { $regex: search, $options: 'i' } },
        { 'paymentInfo.razorpayPaymentId': { $regex: search, $options: 'i' } },
      ];
    }

    // Date range filter
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) filter.createdAt.$gte = new Date(req.query.startDate);
      if (req.query.endDate)   filter.createdAt.$lte = new Date(req.query.endDate);
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email mobile'),
      Order.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count:   orders.length,
      total,
      page,
      pages:   Math.ceil(total / limit),
      orders,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/orders/:id
router.get(
  '/orders/:id',
  [param('id').isMongoId().withMessage('Invalid order ID')],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const order = await Order.findById(req.params.id)
        .populate('user', 'name email mobile addresses')
        .populate('items.product', 'name images slug price stock');

      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      res.status(200).json({ success: true, order });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/admin/orders/:id/status
// ─────────────────────────────────────────────────────────
// CRITICAL STOCK LOGIC:
// ► When status → 'delivered':
//     - product.sold += quantity  (PERMANENTLY, never decremented)
//     - Stock was already deducted at order creation time
//     - soldIncremented flag set to true (idempotent - prevents double-counting)
// ► When status → 'returned':
//     - NO stock restoration (per business requirement)
//     - The sold count is NOT reversed
// ─────────────────────────────────────────────────────────
router.put(
  '/orders/:id/status',
  [
    param('id').isMongoId().withMessage('Invalid order ID'),
    body('status')
      .notEmpty().withMessage('Status is required')
      .isIn(['pending','confirmed','processing','shipped','delivered','returned','cancelled'])
      .withMessage('Invalid order status'),
    body('note').optional().isString().isLength({ max: 500 }),
    body('trackingNumber').optional().isString().isLength({ max: 100 }),
    body('trackingCarrier').optional().isString().isLength({ max: 100 }),
  ],
  async (req, res, next) => {
    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) {
        await dbSession.abortTransaction();
        dbSession.endSession();
        return;
      }

      const { status, note, trackingNumber, trackingCarrier } = req.body;

      const order = await Order.findById(req.params.id)
        .populate('user', 'name email')
        .session(dbSession);

      if (!order) {
        await dbSession.abortTransaction();
        dbSession.endSession();
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      // Prevent invalid status transitions
      const currentStatus = order.orderStatus;
      const terminalStatuses = ['delivered', 'returned', 'cancelled'];
      if (terminalStatuses.includes(currentStatus) && currentStatus !== status) {
        await dbSession.abortTransaction();
        dbSession.endSession();
        return res.status(400).json({
          success: false,
          message: `Cannot change status from '${currentStatus}'. This order has reached a terminal state.`,
        });
      }

      // ────────────────────────────────────────────────────
      // DELIVERED: Increment sold count for each product
      // Only if not already done (soldIncremented guard)
      // ────────────────────────────────────────────────────
      if (status === 'delivered' && !order.soldIncremented) {
        for (const item of order.items) {
          await Product.findByIdAndUpdate(
            item.product,
            { $inc: { sold: item.quantity } },
            { session: dbSession }
          );
        }
        // Mark as done to prevent double-counting if admin accidentally re-sets to delivered
        order.soldIncremented = true;

        console.log(
          `[Order] ✅ Order ${order._id} delivered. ` +
          `Sold counts incremented for ${order.items.length} products.`
        );
      }

      // ────────────────────────────────────────────────────
      // RETURNED: Log but do NOT restore stock
      // ────────────────────────────────────────────────────
      if (status === 'returned') {
        console.log(
          `[Order] ↩️  Order ${order._id} returned. ` +
          `Stock NOT restored (per business policy).`
        );
        // Stock deducted at order creation is intentionally kept reduced.
        // The business absorbs the returned stock as a cost.
      }

      // Update order fields
      order.orderStatus = status;

      if (trackingNumber) order.trackingNumber = trackingNumber.trim();
      if (trackingCarrier) order.trackingCarrier = trackingCarrier.trim();

      // Append to status history
      order.statusHistory.push({
        status,
        changedAt: new Date(),
        changedBy: req.admin.email,
        note:      note ? note.trim() : `Status updated to ${status} by admin`,
      });

      await order.save({ session: dbSession });
      await dbSession.commitTransaction();
      dbSession.endSession();

      // ── Send status update email to customer ─────────────
      // Only send emails for meaningful status changes
      const emailStatuses = ['confirmed', 'processing', 'shipped', 'delivered', 'returned', 'cancelled'];
      if (emailStatuses.includes(status) && order.user && order.user.email) {
        sendEmail({
          to:     order.user.email,
          type:   'orderStatusUpdate',
          user:   { name: order.user.name, email: order.user.email },
          order:  order,
          status: status,
        });
      }

      res.status(200).json({
        success: true,
        message: `Order status updated to '${status}'`,
        order: {
          _id:            order._id,
          orderStatus:    order.orderStatus,
          soldIncremented: order.soldIncremented,
          statusHistory:  order.statusHistory,
          trackingNumber: order.trackingNumber,
          trackingCarrier: order.trackingCarrier,
        },
      });

    } catch (error) {
      await dbSession.abortTransaction();
      dbSession.endSession();
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// ── CUSTOMER MANAGEMENT ───────────────────────────────────
// ══════════════════════════════════════════════════════════

// GET /api/admin/customers
router.get('/customers', async (req, res, next) => {
  try {
    const page    = Math.max(1, parseInt(req.query.page)  || 1);
    const limit   = Math.min(50, parseInt(req.query.limit) || 20);
    const skip    = (page - 1) * limit;
    const search  = req.query.search ? req.query.search.trim() : '';
    const blocked = req.query.blocked;

    const filter = {};
    if (search) {
      filter.$or = [
        { name:   { $regex: search, $options: 'i' } },
        { email:  { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
      ];
    }
    if (blocked !== undefined) {
      filter.isBlocked = blocked === 'true';
    }

    const [customers, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-password -passwordResetToken -passwordResetExpiry'),
      User.countDocuments(filter),
    ]);

    // Add order count for each customer
    const customerIds = customers.map((c) => c._id);
    const orderCounts = await Order.aggregate([
      { $match: { user: { $in: customerIds } } },
      { $group: { _id: '$user', count: { $sum: 1 }, totalSpent: { $sum: '$finalAmount' } } },
    ]);

    const orderMap = {};
    orderCounts.forEach((oc) => {
      orderMap[oc._id.toString()] = { count: oc.count, totalSpent: oc.totalSpent };
    });

    const customersWithStats = customers.map((c) => ({
      ...c.toObject(),
      orderStats: orderMap[c._id.toString()] || { count: 0, totalSpent: 0 },
    }));

    res.status(200).json({
      success: true,
      count:   customers.length,
      total,
      page,
      pages:   Math.ceil(total / limit),
      customers: customersWithStats,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/admin/customers/:id/block - Toggle customer block status
router.put(
  '/customers/:id/block',
  [
    param('id').isMongoId().withMessage('Invalid customer ID'),
    body('isBlocked').isBoolean().withMessage('isBlocked must be true or false'),
    body('reason').optional().isString().isLength({ max: 500 }),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const { isBlocked, reason } = req.body;

      const user = await User.findByIdAndUpdate(
        req.params.id,
        { isBlocked: Boolean(isBlocked) },
        { new: true }
      ).select('-password');

      if (!user) {
        return res.status(404).json({ success: false, message: 'Customer not found' });
      }

      console.log(
        `[Admin] Customer ${user.email} ${isBlocked ? 'BLOCKED' : 'UNBLOCKED'} by admin ${req.admin.email}. ` +
        `Reason: ${reason || 'Not specified'}`
      );

      res.status(200).json({
        success: true,
        message: `Customer account ${isBlocked ? 'blocked' : 'unblocked'} successfully`,
        customer: {
          _id:       user._id,
          name:      user.name,
          email:     user.email,
          isBlocked: user.isBlocked,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// ── CATEGORY MANAGEMENT ───────────────────────────────────
// ══════════════════════════════════════════════════════════

// GET /api/admin/categories
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await Category.find()
      .sort({ sortOrder: 1, name: 1 });

    // Add product count for each category
    const categoryIds = categories.map((c) => c._id);
    const productCounts = await Product.aggregate([
      { $match: { category: { $in: categoryIds }, isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);

    const countMap = {};
    productCounts.forEach((pc) => { countMap[pc._id.toString()] = pc.count; });

    const categoriesWithCounts = categories.map((cat) => ({
      ...cat.toObject(),
      productCount: countMap[cat._id.toString()] || 0,
    }));

    res.status(200).json({
      success:    true,
      count:      categories.length,
      categories: categoriesWithCounts,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/categories
router.post(
  '/categories',
  [
    body('name').trim().notEmpty().withMessage('Category name is required')
      .isLength({ max: 100 }).withMessage('Name cannot exceed 100 characters'),
    body('description').optional().trim()
      .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),
    body('image').optional().trim(),
    body('sortOrder').optional().isInt({ min: 0 }),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const { name, description, image, sortOrder } = req.body;

      const category = await Category.create({
        name:        name.trim(),
        description: description ? description.trim() : '',
        image:       image       || '',
        sortOrder:   sortOrder   !== undefined ? parseInt(sortOrder) : 0,
        isActive:    true,
      });

      res.status(201).json({
        success: true,
        message: 'Category created successfully',
        category,
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/admin/categories/:id
router.put(
  '/categories/:id',
  [
    param('id').isMongoId().withMessage('Invalid category ID'),
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('description').optional().trim(),
    body('sortOrder').optional().isInt({ min: 0 }),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const category = await Category.findById(req.params.id);
      if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found' });
      }

      const allowedFields = ['name', 'description', 'image', 'isActive', 'sortOrder'];
      allowedFields.forEach((field) => {
        if (req.body[field] !== undefined) {
          category[field] = req.body[field];
        }
      });

      await category.save();

      res.status(200).json({
        success: true,
        message: 'Category updated successfully',
        category,
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/admin/categories/:id
router.delete(
  '/categories/:id',
  [param('id').isMongoId().withMessage('Invalid category ID')],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      // Check if any active products use this category
      const productCount = await Product.countDocuments({
        category: req.params.id,
        isActive: true,
      });

      if (productCount > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot delete category with ${productCount} active product(s). Reassign or deactivate products first.`,
        });
      }

      const category = await Category.findByIdAndDelete(req.params.id);
      if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found' });
      }

      res.status(200).json({
        success: true,
        message: 'Category deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// POST /api/admin/seed
// Seeds initial data: admin account, categories, and sample products
// SUPERADMIN ONLY - use requireRole for extra protection
// ══════════════════════════════════════════════════════════
router.post('/seed', requireRole('superadmin', 'admin'), async (req, res, next) => {
  try {
    const results = {
      admins:     [],
      categories: [],
      products:   [],
      skipped:    [],
    };

    // ── 1. Create Default Admin ─────────────────────────
    const adminEmail = 'admin@seawavetoys.com';
    const existingAdmin = await Admin.findOne({ email: adminEmail });

    if (!existingAdmin) {
      const defaultAdmin = await Admin.create({
        name:     'Seawave Admin',
        email:    adminEmail,
        password: 'Admin@123',   // Hashed by pre-save hook
        role:     'superadmin',
        isActive: true,
      });
      results.admins.push({ email: defaultAdmin.email, role: defaultAdmin.role });
    } else {
      results.skipped.push(`Admin: ${adminEmail} already exists`);
    }

    // ── 2. Create Categories ────────────────────────────
    const categoryData = [
      {
        name:        'Activity Boards',
        description: 'Interactive wooden boards packed with activities to develop fine motor skills and cognitive abilities in toddlers.',
        sortOrder:   1,
      },
      {
        name:        'Montessori Boards',
        description: 'Thoughtfully designed Montessori-style busy boards that encourage independent exploration and self-directed learning.',
        sortOrder:   2,
      },
      {
        name:        'Travel Boards',
        description: 'Compact, lightweight wooden busy boards perfect for keeping little ones engaged on the go.',
        sortOrder:   3,
      },
      {
        name:        'Custom Boards',
        description: 'Personalized wooden busy boards crafted to your specifications — choose the activities, colours, and theme.',
        sortOrder:   4,
      },
    ];

    const categoryMap = {};
    for (const catData of categoryData) {
      let cat = await Category.findOne({ name: catData.name });
      if (!cat) {
        cat = await Category.create({ ...catData, isActive: true });
        results.categories.push(cat.name);
      } else {
        results.skipped.push(`Category: ${catData.name} already exists`);
      }
      categoryMap[catData.name] = cat._id;
    }

    // ── 3. Create Sample Products ───────────────────────
    const productData = [
      {
        name:        'Ocean Explorer Busy Board',
        description: 'Dive into fun with our Ocean Explorer Busy Board! This premium handcrafted wooden board features 12 engaging activities including a working door latch, spinning gears, a bead maze, colour-matching tiles, a sliding bolt, a key lock, a buckle clasp, and more. Made from high-quality birch wood with non-toxic, child-safe paint. Perfect for toddlers aged 1-3 years to develop fine motor skills, hand-eye coordination, and problem-solving abilities. Each board is individually crafted and inspected for safety.',
        price:       2499,
        mrp:         3499,
        category:    'Activity Boards',
        stock:       50,
        ageGroup:    '1-3 years',
        tags:        ['activity board', 'busy board', 'montessori', 'wooden toy', 'educational', 'ocean theme'],
        dimensions:  { length: 40, width: 30, height: 3 },
        weight:      1200,
        isFeatured:  true,
        images:      [],
      },
      {
        name:        'Montessori Discovery Board',
        description: 'Inspired by Montessori principles, this Discovery Board encourages children to learn through hands-on exploration. Features 10 carefully selected activities: a zipper, velcro straps, button board, rotating clock face, light switch, drawer with knob, abacus row, puzzle lock, musical bell, and a counting bead frame. The natural wood finish and earth-tone colours create a calming, focused environment for learning. Suitable for children 2-5 years. All materials are CPSC compliant and thoroughly tested for safety.',
        price:       3299,
        mrp:         4299,
        category:    'Montessori Boards',
        stock:       35,
        ageGroup:    '2-5 years',
        tags:        ['montessori', 'discovery board', 'educational toy', 'wooden', 'sensory play', 'learning'],
        dimensions:  { length: 45, width: 35, height: 3 },
        weight:      1500,
        isFeatured:  true,
        images:      [],
      },
      {
        name:        'Little Traveller Mini Board',
        description: 'Compact and travel-friendly, the Little Traveller Mini Board is your perfect co-pilot for long journeys! At just 25×20cm, it fits in any backpack or carry-on bag. Despite its small size, it packs in 8 engaging activities: a mini zipper, snap buttons, a tiny bolt, a spinning dial, a hook and eye closure, a velcro strap, a bead slider, and a colour matching game. Made from lightweight beech wood with rounded edges and smooth surfaces. Great for toddlers 18 months and up. Comes with a travel pouch.',
        price:       1799,
        mrp:         2299,
        category:    'Travel Boards',
        stock:       60,
        ageGroup:    '1-3 years',
        tags:        ['travel toy', 'mini busy board', 'portable', 'wooden', 'toddler toy', 'compact'],
        dimensions:  { length: 25, width: 20, height: 2.5 },
        weight:      600,
        isFeatured:  false,
        images:      [],
      },
      {
        name:        'Rainbow Skills Busy Board',
        description: 'A vibrant, rainbow-themed busy board that makes learning irresistible! This large format board features 15 colourful activities across a cheerful rainbow design: colour-coded latches, rainbow bead maze, spinning flower, rainbow buttons, zipper in 5 colours, velcro fruits, snap closures, hook and loop, push-button lights (battery-free), counting bears, shape sorter, rope threading, mirror discovery, gear train, and a chalkboard section. Premium plywood construction with non-toxic, washable paint. Ideal for ages 1-4 years. Designed by Montessori-trained educators.',
        price:       3999,
        mrp:         4999,
        category:    'Activity Boards',
        stock:       25,
        ageGroup:    '1-4 years',
        tags:        ['rainbow toy', 'busy board', 'colourful', 'educational', 'large board', 'skills development'],
        dimensions:  { length: 60, width: 45, height: 3.5 },
        weight:      2200,
        isFeatured:  true,
        images:      [],
      },
    ];

    for (const pData of productData) {
      const existing = await Product.findOne({ name: pData.name });
      if (!existing) {
        const categoryId = categoryMap[pData.category];
        if (!categoryId) {
          results.skipped.push(`Product: ${pData.name} - category not found`);
          continue;
        }

        const product = await Product.create({
          ...pData,
          category: categoryId,
        });
        results.products.push({ name: product.name, price: product.price, stock: product.stock });
      } else {
        results.skipped.push(`Product: ${pData.name} already exists`);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Seed completed successfully!',
      results,
      loginCredentials: {
        email:    'admin@seawavetoys.com',
        password: 'Admin@123',
        note:     'Please change the admin password immediately after first login!',
      },
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;
