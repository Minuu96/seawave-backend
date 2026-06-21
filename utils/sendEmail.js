/**
 * utils/sendEmail.js - Email Sending Utility with HTML Templates
 * Sends transactional emails for Seawave Toys using Gmail SMTP.
 *
 * Email Types:
 *   1. Welcome Email        - Sent on successful customer registration
 *   2. Order Confirmation   - Sent when order is placed and payment confirmed
 *   3. Order Status Update  - Sent when admin updates order status (shipped/delivered)
 *
 * Sender: manasparakhiya@gmail.com (configured via ENV)
 * Branding: Seawave Toys - Wooden Busy Boards
 */

'use strict';

const transporter = require('../config/email');

// ─── Brand Colors & Styles ─────────────────────────────────
const BRAND = {
  primary:    '#2A6496',   // Ocean blue
  secondary:  '#F5A623',   // Warm amber
  light:      '#F0F8FF',   // Alice blue background
  dark:       '#1A3A5C',   // Deep navy
  text:       '#333333',
  lightText:  '#666666',
  white:      '#FFFFFF',
  success:    '#27AE60',
  warning:    '#F39C12',
  info:       '#2980B9',
};

// ─── Base HTML Template Wrapper ────────────────────────────
/**
 * Wraps content in a consistent branded email shell.
 * @param {string} content - Inner HTML content
 * @param {string} title   - Email subject / page title
 * @returns {string} Complete HTML email
 */
const emailShell = (content, title = 'Seawave Toys') => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background-color: #f4f4f4;
      color: ${BRAND.text};
      line-height: 1.6;
    }
    .wrapper {
      max-width: 600px;
      margin: 20px auto;
      background: ${BRAND.white};
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, ${BRAND.primary}, ${BRAND.dark});
      padding: 30px 40px;
      text-align: center;
    }
    .header .logo {
      font-size: 28px;
      font-weight: 800;
      color: ${BRAND.white};
      letter-spacing: 1px;
    }
    .header .logo span {
      color: ${BRAND.secondary};
    }
    .header .tagline {
      font-size: 13px;
      color: rgba(255,255,255,0.8);
      margin-top: 4px;
    }
    .body {
      padding: 35px 40px;
    }
    .greeting {
      font-size: 22px;
      font-weight: 700;
      color: ${BRAND.dark};
      margin-bottom: 12px;
    }
    .text {
      font-size: 15px;
      color: ${BRAND.lightText};
      margin-bottom: 16px;
    }
    .highlight-box {
      background: ${BRAND.light};
      border-left: 4px solid ${BRAND.primary};
      border-radius: 8px;
      padding: 16px 20px;
      margin: 20px 0;
    }
    .btn {
      display: inline-block;
      background: ${BRAND.secondary};
      color: ${BRAND.white} !important;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 15px;
      margin: 20px 0;
      letter-spacing: 0.5px;
    }
    .btn:hover { background: #E09200; }
    table.order-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 14px;
    }
    table.order-table th {
      background: ${BRAND.primary};
      color: ${BRAND.white};
      padding: 10px 14px;
      text-align: left;
    }
    table.order-table td {
      padding: 10px 14px;
      border-bottom: 1px solid #eee;
    }
    table.order-table tr:last-child td { border-bottom: none; }
    table.order-table tr:nth-child(even) td { background: #fafafa; }
    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 14px;
    }
    .summary-row.total {
      font-weight: 700;
      font-size: 16px;
      color: ${BRAND.dark};
      border-top: 2px solid ${BRAND.primary};
      padding-top: 10px;
      margin-top: 6px;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 20px;
      font-weight: 700;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .divider {
      border: none;
      border-top: 1px solid #eee;
      margin: 24px 0;
    }
    .footer {
      background: ${BRAND.dark};
      color: rgba(255,255,255,0.7);
      text-align: center;
      padding: 24px 40px;
      font-size: 13px;
    }
    .footer a { color: ${BRAND.secondary}; text-decoration: none; }
    .footer .social { margin: 10px 0; }
    @media (max-width: 600px) {
      .body { padding: 24px 20px; }
      .header { padding: 24px 20px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="logo">🌊 Seawave<span>Toys</span></div>
      <div class="tagline">Handcrafted Wooden Busy Boards for Little Explorers</div>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Seawave Toys. All rights reserved.</p>
      <p style="margin-top:6px;">
        Questions? Email us at
        <a href="mailto:${process.env.EMAIL_USER}">${process.env.EMAIL_USER}</a>
      </p>
      <p style="margin-top:10px; font-size:11px; color:rgba(255,255,255,0.4);">
        This is an automated email. Please do not reply directly to this email.
      </p>
    </div>
  </div>
</body>
</html>
`;

// ─── Status Badge Colors ───────────────────────────────────
const getStatusColor = (status) => {
  const colors = {
    pending:    { bg: '#FFF3CD', text: '#856404' },
    confirmed:  { bg: '#D1ECF1', text: '#0C5460' },
    processing: { bg: '#D1ECF1', text: '#0C5460' },
    shipped:    { bg: '#CCE5FF', text: '#004085' },
    delivered:  { bg: '#D4EDDA', text: '#155724' },
    returned:   { bg: '#F8D7DA', text: '#721C24' },
    cancelled:  { bg: '#F8D7DA', text: '#721C24' },
  };
  return colors[status] || { bg: '#E2E3E5', text: '#383D41' };
};

// ─── FORMAT CURRENCY ──────────────────────────────────────
const formatCurrency = (amount) =>
  `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

// ─── FORMAT DATE ──────────────────────────────────────────
const formatDate = (date) =>
  new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

// ══════════════════════════════════════════════════════════
// EMAIL TEMPLATE FUNCTIONS
// ══════════════════════════════════════════════════════════

/**
 * Generates OTP Email HTML.
 * @param {string} otp - The 6-digit OTP code
 * @returns {string} HTML email content
 */
const otpTemplate = (otp) => {
  const content = `
    <div class="greeting">Your Verification Code 🔐</div>
    <p class="text">
      Please use the following verification code to sign in or complete your registration
      at Seawave Toys.
    </p>

    <div class="highlight-box" style="text-align: center; padding: 24px;">
      <div style="font-size:32px; font-weight:800; color:${BRAND.primary}; letter-spacing:8px;">${otp}</div>
    </div>

    <p class="text" style="text-align:center; font-size:14px;">
      This code is valid for <strong>5 minutes</strong>. Please do not share it with anyone.
    </p>

    <hr class="divider" />
    <p style="font-size: 13px; color: ${BRAND.lightText}; text-align: center;">
      If you didn't request this code, you can safely ignore this email.
    </p>
  `;
  return emailShell(content, 'Your Verification Code');
};

/**
 * Generates Welcome Email HTML for newly registered customers.
 * @param {Object} user - User object { name, email }
 * @returns {string} HTML email content
 */
const welcomeEmailTemplate = (user) => {
  const content = `
    <div class="greeting">Welcome to Seawave Toys, ${user.name}! 🎉</div>
    <p class="text">
      Thank you for joining our family! We're so excited to have you here.
      Seawave Toys crafts premium handmade wooden busy boards that spark creativity,
      develop fine motor skills, and provide hours of joyful learning for your little ones.
    </p>

    <div class="highlight-box">
      <strong>🌊 Your account is ready!</strong><br />
      <span style="font-size:14px; color: ${BRAND.lightText};">
        Email: <strong>${user.email}</strong>
      </span>
    </div>

    <p class="text">Here's what you can do with your account:</p>
    <ul style="margin: 0 0 20px 20px; color: ${BRAND.lightText}; font-size: 15px; line-height: 2;">
      <li>Browse our collection of handcrafted wooden busy boards</li>
      <li>Save your favourite products to your wishlist</li>
      <li>Track your orders in real time</li>
      <li>Save multiple delivery addresses for convenience</li>
    </ul>

    <p class="text">
      Each Seawave Toy is lovingly crafted from premium, child-safe wood with non-toxic
      finishes. Our busy boards are designed to entertain toddlers while building
      essential skills like problem-solving, hand-eye coordination, and colour recognition.
    </p>

    <hr class="divider" />
    <p style="font-size: 13px; color: ${BRAND.lightText}; text-align: center;">
      Happy exploring! 🌟<br />
      <strong>The Seawave Toys Team</strong>
    </p>
  `;
  return emailShell(content, 'Welcome to Seawave Toys!');
};

/**
 * Generates Order Confirmation Email HTML.
 * @param {Object} order  - Order document (populated with items)
 * @param {Object} user   - User object { name, email }
 * @returns {string} HTML email content
 */
const orderConfirmationTemplate = (order, user) => {
  const itemsHtml = order.items.map((item) => `
    <tr>
      <td style="font-weight:600;">${item.name}</td>
      <td style="text-align:center;">${item.quantity}</td>
      <td style="text-align:right;">${formatCurrency(item.price)}</td>
      <td style="text-align:right; font-weight:700;">${formatCurrency(item.price * item.quantity)}</td>
    </tr>
  `).join('');

  const orderNumber = `SW-${new Date(order.createdAt).getFullYear()}-${order._id.toString().slice(-6).toUpperCase()}`;

  const content = `
    <div class="greeting">Order Confirmed! 🎉</div>
    <p class="text">
      Hi <strong>${user.name}</strong>, great news! Your order has been received and
      confirmed. We'll notify you as soon as it's on its way!
    </p>

    <div class="highlight-box">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
        <div>
          <div style="font-size:13px; color:${BRAND.lightText};">ORDER NUMBER</div>
          <div style="font-size:20px; font-weight:800; color:${BRAND.dark};">${orderNumber}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:13px; color:${BRAND.lightText};">ORDER DATE</div>
          <div style="font-size:15px; font-weight:600;">${formatDate(order.createdAt)}</div>
        </div>
      </div>
    </div>

    <h3 style="font-size:16px; color:${BRAND.dark}; margin:24px 0 10px;">🛍️ Items Ordered</h3>
    <table class="order-table">
      <thead>
        <tr>
          <th>Product</th>
          <th style="text-align:center;">Qty</th>
          <th style="text-align:right;">Price</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div style="background:#fafafa; border-radius:8px; padding:16px 20px; margin:10px 0;">
      <div class="summary-row">
        <span>Subtotal</span>
        <span>${formatCurrency(order.totalAmount)}</span>
      </div>
      ${order.taxAmount > 0 ? `
      <div class="summary-row">
        <span>Taxes & GST</span>
        <span>${formatCurrency(order.taxAmount)}</span>
      </div>` : ''}
      ${order.discountAmount > 0 ? `
      <div class="summary-row" style="color:${BRAND.success};">
        <span>Discount Applied</span>
        <span>- ${formatCurrency(order.discountAmount)}</span>
      </div>` : ''}
      <div class="summary-row total">
        <span>Amount Paid</span>
        <span>${formatCurrency(order.finalAmount)}</span>
      </div>
    </div>

    <h3 style="font-size:16px; color:${BRAND.dark}; margin:24px 0 10px;">📦 Delivery Address</h3>
    <div style="background:#f9f9f9; border-radius:8px; padding:16px 20px; font-size:14px; color:${BRAND.lightText}; line-height:1.8;">
      <strong style="color:${BRAND.text};">${order.shippingAddress.fullName}</strong><br />
      ${order.shippingAddress.phone}<br />
      ${order.shippingAddress.addressLine1}${order.shippingAddress.addressLine2 ? ', ' + order.shippingAddress.addressLine2 : ''}<br />
      ${order.shippingAddress.city}, ${order.shippingAddress.state} - ${order.shippingAddress.pincode}
    </div>

    <hr class="divider" />
    <p class="text" style="font-size:13px; text-align:center;">
      💳 Payment via Razorpay — ID: <code>${order.paymentInfo.razorpayPaymentId || 'Processing'}</code>
    </p>
    <p style="font-size: 13px; color: ${BRAND.lightText}; text-align:center;">
      We'll send you tracking details as soon as your order ships.<br />
      Thank you for choosing Seawave Toys! 🌊
    </p>
  `;
  return emailShell(content, `Order Confirmed — ${orderNumber}`);
};

/**
 * Generates Order Status Update Email HTML.
 * Sent when admin changes order status to 'shipped' or 'delivered'.
 *
 * @param {Object} order  - Order document
 * @param {Object} user   - User object { name, email }
 * @param {string} status - New status string
 * @returns {string} HTML email content
 */
const orderStatusUpdateTemplate = (order, user, status) => {
  const orderNumber = `SW-${new Date(order.createdAt).getFullYear()}-${order._id.toString().slice(-6).toUpperCase()}`;
  const statusColor = getStatusColor(status);

  // Dynamic messaging based on status
  const statusMessages = {
    confirmed: {
      icon: '✅',
      headline: 'Your Order Has Been Confirmed!',
      body: `Great news! Your order <strong>${orderNumber}</strong> has been confirmed by our team. We are now carefully preparing your wooden busy board.`,
    },
    processing: {
      icon: '🔨',
      headline: 'Your Order Is Being Prepared',
      body: `Our craftspeople are now lovingly preparing your order <strong>${orderNumber}</strong>. Each Seawave busy board is handcrafted with care — great things take a little time!`,
    },
    shipped: {
      icon: '🚚',
      headline: 'Your Order Is On Its Way!',
      body: `Exciting news! Your order <strong>${orderNumber}</strong> has been shipped and is on its way to you. ${order.trackingNumber ? `Your tracking number is <strong>${order.trackingNumber}</strong>${order.trackingCarrier ? ` (${order.trackingCarrier})` : ''}.` : 'You will receive tracking details shortly.'}`,
    },
    delivered: {
      icon: '📦',
      headline: 'Your Order Has Been Delivered!',
      body: `Your order <strong>${orderNumber}</strong> has been marked as delivered. We hope your little one absolutely loves their new Seawave busy board! 🌊`,
    },
    returned: {
      icon: '↩️',
      headline: 'Your Return Has Been Processed',
      body: `Your return for order <strong>${orderNumber}</strong> has been processed. If you have any questions about your refund, please contact our support team.`,
    },
    cancelled: {
      icon: '❌',
      headline: 'Your Order Has Been Cancelled',
      body: `Your order <strong>${orderNumber}</strong> has been cancelled. If a payment was made, a refund will be initiated within 5-7 business days. Please contact us if you have any concerns.`,
    },
  };

  const msg = statusMessages[status] || {
    icon: '📋',
    headline: 'Order Update',
    body: `Your order <strong>${orderNumber}</strong> status has been updated to <strong>${status}</strong>.`,
  };

  const content = `
    <div class="greeting">${msg.icon} ${msg.headline}</div>
    <p class="text">Hi <strong>${user.name}</strong>,</p>
    <p class="text">${msg.body}</p>

    <div class="highlight-box">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
        <div>
          <div style="font-size:13px; color:${BRAND.lightText};">ORDER NUMBER</div>
          <div style="font-size:18px; font-weight:800; color:${BRAND.dark};">${orderNumber}</div>
        </div>
        <div>
          <span
            class="status-badge"
            style="background:${statusColor.bg}; color:${statusColor.text};"
          >${status.toUpperCase()}</span>
        </div>
      </div>
    </div>

    <h3 style="font-size:16px; color:${BRAND.dark}; margin:20px 0 10px;">🛍️ Order Summary</h3>
    <div style="background:#fafafa; border-radius:8px; padding:16px 20px;">
      ${order.items.map((item) => `
        <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #eee; font-size:14px;">
          <span><strong>${item.name}</strong> × ${item.quantity}</span>
          <span>${formatCurrency(item.price * item.quantity)}</span>
        </div>
      `).join('')}
      <div style="display:flex; justify-content:space-between; padding:10px 0 0; font-size:15px; font-weight:700; color:${BRAND.dark};">
        <span>Total Paid</span>
        <span>${formatCurrency(order.finalAmount)}</span>
      </div>
    </div>

    ${status === 'delivered' ? `
    <div style="background:${BRAND.light}; border-radius:8px; padding:20px; margin:20px 0; text-align:center;">
      <div style="font-size:24px; margin-bottom:8px;">⭐⭐⭐⭐⭐</div>
      <p style="font-size:15px; color:${BRAND.dark}; font-weight:600;">Enjoying your Seawave busy board?</p>
      <p style="font-size:13px; color:${BRAND.lightText};">We'd love to hear your feedback!</p>
    </div>
    ` : ''}

    <hr class="divider" />
    <p style="font-size: 13px; color: ${BRAND.lightText}; text-align:center;">
      Have questions about your order? Reply to this email or contact us at
      <a href="mailto:${process.env.EMAIL_USER}" style="color:${BRAND.primary};">${process.env.EMAIL_USER}</a>
    </p>
  `;
  return emailShell(content, `Order ${status.charAt(0).toUpperCase() + status.slice(1)} — ${orderNumber}`);
};

// ══════════════════════════════════════════════════════════
// MAIN sendEmail FUNCTION
// ══════════════════════════════════════════════════════════

/**
 * Sends an email using the configured Gmail SMTP transporter.
 * Supports three email types with beautiful HTML templates.
 *
 * @param {Object} options
 * @param {string} options.to          - Recipient email address
 * @param {string} options.type        - Email type: 'otp' | 'welcome' | 'orderConfirmation' | 'orderStatusUpdate'
 * @param {Object} [options.user]      - User object { name, email }
 * @param {Object} [options.order]     - Order document (required for order emails)
 * @param {string} [options.status]    - New order status (for orderStatusUpdate type)
 * @param {string} [options.otp]       - OTP code (for otp type)
 *
 * @returns {Promise<void>}
 */
const sendEmail = async ({ to, type, user, order, status, otp }) => {
  try {
    let subject = '';
    let htmlContent = '';

    switch (type) {
      case 'otp':
        subject = '🔐 Your Seawave Toys Verification Code';
        htmlContent = otpTemplate(otp);
        break;

      case 'welcome':
        subject = '🌊 Welcome to Seawave Toys – Your Adventure Begins!';
        htmlContent = welcomeEmailTemplate(user);
        break;

      case 'orderConfirmation':
        if (!order) throw new Error('Order object is required for orderConfirmation email');
        const orderNum = `SW-${new Date(order.createdAt).getFullYear()}-${order._id.toString().slice(-6).toUpperCase()}`;
        subject = `🎉 Order Confirmed — ${orderNum} | Seawave Toys`;
        htmlContent = orderConfirmationTemplate(order, user);
        break;

      case 'orderStatusUpdate':
        if (!order || !status) throw new Error('Order and status are required for orderStatusUpdate email');
        const oNum = `SW-${new Date(order.createdAt).getFullYear()}-${order._id.toString().slice(-6).toUpperCase()}`;
        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
        subject = `📦 Order ${statusLabel} — ${oNum} | Seawave Toys`;
        htmlContent = orderStatusUpdateTemplate(order, user, status);
        break;

      default:
        throw new Error(`Unknown email type: ${type}`);
    }

    const mailOptions = {
      from: `"Seawave Toys 🌊" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html: htmlContent,
      // Plain text fallback for email clients that don't support HTML
      text: `${subject}\n\nPlease view this email in an HTML-compatible email client.\n\nSeawave Toys — ${process.env.EMAIL_USER}`,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Email] ✅ ${type} email sent to ${to} (msgId: ${info.messageId})`);

  } catch (error) {
    // Log email errors but do NOT throw — email failures should not crash order flows
    console.error(`[Email] ❌ Failed to send ${type} email to ${to}: ${error.message}`);
    // In production, consider integrating an error monitoring service here (e.g., Sentry)
  }
};

module.exports = sendEmail;
