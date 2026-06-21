/**
 * routes/products.js - Public Product & Category Routes
 * These routes are publicly accessible (no auth required).
 *
 * Routes:
 *   GET /api/products            - List products with filters, pagination, sorting
 *   GET /api/products/featured   - Featured products (up to 8 active)
 *   GET /api/products/:id        - Single product detail by ID or slug
 *   GET /api/categories          - List all active categories (mounted separately)
 */

'use strict';

const express = require('express');
const { param, query, validationResult } = require('express-validator');
const mongoose = require('mongoose');

const Product  = require('../models/Product');
const Category = require('../models/Category');

const router = express.Router();

// ─── Helper: Handle validation errors ────────────────────
const handleValidationErrors = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Invalid query parameters',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  return null;
};

// ══════════════════════════════════════════════════════════
// GET /api/products/featured
// IMPORTANT: Defined BEFORE /:id to prevent 'featured' being
// interpreted as an ObjectId parameter
// Returns first 8 active products (prioritizes isFeatured flag)
// ══════════════════════════════════════════════════════════
router.get('/featured', async (req, res, next) => {
  try {
    const products = await Product.find({ isActive: true })
      .sort({ isFeatured: -1, sold: -1, createdAt: -1 })
      .limit(8)
      .populate('category', 'name slug')
      .lean();

    res.status(200).json({
      success: true,
      count:    products.length,
      products,
    });
  } catch (error) {
    next(error);
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/products
// Filtering, pagination, and sorting
//
// Query Parameters:
//   category   {string}  - Category ObjectId or slug
//   search     {string}  - Full-text search term
//   minPrice   {number}  - Minimum price (inclusive)
//   maxPrice   {number}  - Maximum price (inclusive)
//   ageGroup   {string}  - e.g., '1-3 years', '3-5 years'
//   tags       {string}  - Comma-separated tags, e.g., 'wooden,educational'
//   sort       {string}  - 'newest' | 'price_asc' | 'price_desc' | 'popular'
//   page       {number}  - Page number (default: 1)
//   limit      {number}  - Items per page (default: 12, max: 48)
// ══════════════════════════════════════════════════════════
router.get(
  '/',
  [
    query('minPrice')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('minPrice must be a non-negative number'),
    query('maxPrice')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('maxPrice must be a non-negative number'),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 48 })
      .withMessage('Limit must be between 1 and 48'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      // ── Build MongoDB filter object ──
      const filter = { isActive: true };

      // Filter by category (accepts ObjectId or slug)
      if (req.query.category) {
        if (mongoose.Types.ObjectId.isValid(req.query.category)) {
          filter.category = new mongoose.Types.ObjectId(req.query.category);
        } else {
          // Look up category by slug
          const cat = await Category.findOne({
            slug: req.query.category.toLowerCase().trim(),
          }).lean();
          if (cat) {
            filter.category = cat._id;
          } else {
            // Unknown category slug → return empty result
            return res.status(200).json({
              success: true,
              count: 0,
              total: 0,
              page: 1,
              pages: 0,
              products: [],
            });
          }
        }
      }

      // Price range filter
      if (req.query.minPrice || req.query.maxPrice) {
        filter.price = {};
        if (req.query.minPrice) filter.price.$gte = parseFloat(req.query.minPrice);
        if (req.query.maxPrice) filter.price.$lte = parseFloat(req.query.maxPrice);
      }

      // Age group filter
      if (req.query.ageGroup) {
        filter.ageGroup = req.query.ageGroup.trim();
      }

      // Tags filter (comma-separated)
      if (req.query.tags) {
        const tagList = req.query.tags
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        if (tagList.length > 0) {
          filter.tags = { $in: tagList };
        }
      }

      // Full-text search (uses MongoDB text index on name, description, tags)
      let searchScore = {};
      if (req.query.search && req.query.search.trim()) {
        filter.$text = { $search: req.query.search.trim() };
        // When using $text, we can sort by relevance score
        searchScore = { score: { $meta: 'textScore' } };
      }

      // ── Sort options ──
      const sortMap = {
        newest:     { createdAt: -1 },
        price_asc:  { price: 1 },
        price_desc: { price: -1 },
        popular:    { sold: -1, createdAt: -1 },
        featured:   { isFeatured: -1, sold: -1 },
      };

      let sort = sortMap[req.query.sort] || sortMap.newest;
      // If doing text search and no explicit sort, sort by relevance
      if (filter.$text && !req.query.sort) {
        sort = { score: { $meta: 'textScore' } };
      }

      // ── Pagination ──
      const page  = Math.max(1, parseInt(req.query.page)  || 1);
      const limit = Math.min(48, parseInt(req.query.limit) || 12);
      const skip  = (page - 1) * limit;

      // ── Execute count + fetch in parallel ──
      const [products, total] = await Promise.all([
        Product.find(filter, searchScore)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .populate('category', 'name slug')
          .lean(),
        Product.countDocuments(filter),
      ]);

      res.status(200).json({
        success: true,
        count:    products.length,
        total,
        page,
        pages:    Math.ceil(total / limit),
        products,
      });

    } catch (error) {
      next(error);
    }
  }
);

// ══════════════════════════════════════════════════════════
// GET /api/products/:id
// Get single product by MongoDB ObjectId OR slug
// Also returns up to 4 related products from same category
// ══════════════════════════════════════════════════════════
router.get(
  '/:id',
  [
    param('id').trim().notEmpty().withMessage('Product ID or slug is required'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidationErrors(req, res);
      if (validationError) return;

      const { id } = req.params;
      let product;

      // Check if param looks like a valid ObjectId
      if (mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
        product = await Product.findOne({ _id: id, isActive: true })
          .populate('category', 'name slug description');
      } else {
        // Treat as URL slug
        product = await Product.findOne({ slug: id, isActive: true })
          .populate('category', 'name slug description');
      }

      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found or is no longer available',
        });
      }

      // Fetch related products from same category
      const relatedProducts = await Product.find({
        category: product.category._id,
        isActive: true,
        _id: { $ne: product._id },
      })
        .limit(4)
        .select('name price mrp images slug ageGroup stock')
        .lean();

      res.status(200).json({
        success: true,
        product,
        relatedProducts,
      });

    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
