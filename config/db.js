/**
 * config/db.js - MongoDB Connection with Retry Logic
 * Connects to local MongoDB instance. Retries up to 5 times
 * with exponential backoff before giving up.
 */

'use strict';

const mongoose = require('mongoose');

// Maximum number of connection retry attempts
const MAX_RETRIES = 5;
// Base delay between retries in milliseconds (doubles each time)
const RETRY_DELAY_MS = 2000;

/**
 * Attempts to connect to MongoDB.
 * Implements exponential backoff retry strategy.
 *
 * @param {number} attempt - Current attempt number (starts at 1)
 */
const connectDB = async (attempt = 1) => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/seawave-toys';

    console.log(`[DB] Connecting to MongoDB (attempt ${attempt}/${MAX_RETRIES})...`);

    const conn = await mongoose.connect(mongoUri, {
      // These options ensure a stable, performant connection
      serverSelectionTimeoutMS: 5000,   // Timeout after 5s if no server found
      socketTimeoutMS: 45000,           // Close sockets after 45s of inactivity
      maxPoolSize: 10,                  // Maintain up to 10 socket connections
    });

    console.log(`[DB] ✅ MongoDB Connected: ${conn.connection.host}:${conn.connection.port}/${conn.connection.name}`);

    // ── Event Listeners for connection lifecycle ──

    // Fires when mongoose loses DB connection
    mongoose.connection.on('disconnected', () => {
      console.warn('[DB] ⚠️  MongoDB disconnected. Attempting to reconnect...');
    });

    // Fires when mongoose reconnects
    mongoose.connection.on('reconnected', () => {
      console.log('[DB] ✅ MongoDB reconnected.');
    });

    // Fires on connection error after initial connect
    mongoose.connection.on('error', (err) => {
      console.error(`[DB] ❌ MongoDB connection error: ${err.message}`);
    });

  } catch (error) {
    console.error(`[DB] ❌ Connection attempt ${attempt} failed: ${error.message}`);

    if (attempt < MAX_RETRIES) {
      // Exponential backoff: 2s, 4s, 8s, 16s, 32s
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[DB] Retrying in ${delay / 1000}s...`);

      await new Promise((resolve) => setTimeout(resolve, delay));
      return connectDB(attempt + 1);
    } else {
      // All retry attempts exhausted - cannot continue without DB
      console.error(`[DB] ❌ Could not connect to MongoDB after ${MAX_RETRIES} attempts. Exiting.`);
      process.exit(1);
    }
  }
};

module.exports = connectDB;
