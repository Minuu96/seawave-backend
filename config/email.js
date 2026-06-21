/**
 * config/email.js - Nodemailer Transporter Configuration
 * Creates a reusable Gmail SMTP transporter using App Password authentication.
 * App Passwords are required when 2FA is enabled on the Gmail account.
 *
 * Setup: https://myaccount.google.com/apppasswords
 */

'use strict';

const nodemailer = require('nodemailer');

/**
 * Creates and returns a configured Nodemailer transporter.
 * Uses Gmail SMTP with App Password (not the actual Google account password).
 *
 * ENV Variables Required:
 *   EMAIL_USER         - Gmail address (e.g., manasparakhiya@gmail.com)
 *   EMAIL_APP_PASSWORD - Gmail App Password (16-char, no spaces)
 */
const createTransporter = () => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,       // true for port 465, false for port 587 (STARTTLS)
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD,
    },
    // Connection pool settings for better performance under load
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    // Timeout settings
    connectionTimeout: 10000,  // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  return transporter;
};

// Create a singleton transporter instance
const transporter = createTransporter();

/**
 * Verifies the transporter connection.
 * Call this at startup to ensure email credentials are valid.
 */
const verifyEmailConnection = async () => {
  try {
    await transporter.verify();
    console.log('[Email] ✅ Gmail SMTP transporter is ready');
  } catch (error) {
    // Don't crash the app - just warn. Email is non-critical at startup.
    console.warn(`[Email] ⚠️  Email transporter verification failed: ${error.message}`);
    console.warn('[Email] Check EMAIL_USER and EMAIL_APP_PASSWORD in .env');
  }
};

// Verify on module load (non-blocking)
verifyEmailConnection();

module.exports = transporter;
