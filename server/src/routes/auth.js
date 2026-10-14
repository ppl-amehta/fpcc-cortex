const express = require('express');
const router = express.Router();
const db = require('../db');
const { createToken, verifySecret, hashSecret } = require('../utils');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

/**
 * POST /api/auth/pin-login
 * Frictionless shop floor tablet PIN login for non-tech workers
 */
router.post('/pin-login', (req, res, next) => {
  try {
    const { userId, pin } = req.body;
    if (!userId || !pin) {
      throw new AppError('userId and pin are required', 400);
    }

    const user = db.get('SELECT * FROM users WHERE id = ? OR user_name = ?', [userId.trim(), userId.trim()]);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (!user.active) {
      throw new AppError('User account is deactivated', 403);
    }

    // Check PIN match (direct equality or hashed)
    const isValid = verifySecret(pin, user.pin_code);
    if (!isValid) {
      throw new AppError('Invalid PIN code', 401);
    }

    // Generate zero-dependency JWT token
    const token = createToken({
      id: user.id,
      userName: user.user_name,
      role: user.role
    }, 86400 * 7); // 7-day token for floor tablet persistence

    // Return safe user object
    const { pin_code, ...safeUser } = user;

    res.json({
      success: true,
      token,
      user: safeUser
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 * Profile check for authenticated session
 */
router.get('/me', authenticate, (req, res) => {
  const { pin_code, ...safeUser } = req.user;
  res.json({
    success: true,
    user: safeUser
  });
});

/**
 * GET /api/auth/users
 * List active users for floor tablet selector
 */
router.get('/users', (req, res, next) => {
  try {
    const users = db.query(
      'SELECT id, user_name, email, role, can_inward, can_issue, can_return, edit_master, can_block FROM users WHERE active = 1 ORDER BY role, user_name'
    );
    res.json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/update-pin
 * Update worker PIN
 */
router.post('/update-pin', authenticate, (req, res, next) => {
  try {
    const { currentPin, newPin } = req.body;
    if (!newPin || newPin.length < 4) {
      throw new AppError('New PIN must be at least 4 digits', 400);
    }

    const user = db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) throw new AppError('User not found', 404);

    if (currentPin && !verifySecret(currentPin, user.pin_code)) {
      throw new AppError('Current PIN is incorrect', 401);
    }

    const hashed = hashSecret(newPin);
    db.run('UPDATE users SET pin_code = ? WHERE id = ?', [hashed, user.id]);

    db.audit(
      req.user.id,
      req.user.user_name,
      'AUTH',
      'PIN_UPDATED',
      'users',
      user.id,
      null,
      null,
      `User ${user.user_name} updated access PIN`
    );

    res.json({
      success: true,
      message: 'PIN successfully updated'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
