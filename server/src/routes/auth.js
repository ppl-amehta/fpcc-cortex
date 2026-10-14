const express = require('express');
const router = express.Router();
const db = require('../db');
const { createToken, verifySecret, hashSecret } = require('../utils');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const rolesService = require('../services/roles.service');

/**
 * POST /api/auth/login
 * Full password/PIN authentication
 */
router.post('/login', (req, res, next) => {
  try {
    const { username, userId, password, pin } = req.body;
    const identifier = userId || username;
    const secret = password || pin;

    if (!identifier || !secret) {
      throw new AppError('Username/userId and password/pin are required', 400);
    }

    const authResult = rolesService.authenticateUser(identifier, secret);
    if (!authResult.success) {
      throw new AppError(authResult.error, 401);
    }

    res.json(authResult);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/switch-user
 * Frictionless or password-protected user switcher
 */
router.post('/switch-user', (req, res, next) => {
  try {
    const { userId, password } = req.body;
    if (!userId) {
      throw new AppError('userId is required', 400);
    }

    const switchResult = rolesService.switchUser(userId, password);
    if (!switchResult.success) {
      return res.status(switchResult.passwordRequired ? 401 : 400).json(switchResult);
    }

    res.json(switchResult);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/settings
 * Introspect auth requirements (e.g. requirePasswordAuth toggle)
 */
router.get('/settings', (req, res, next) => {
  try {
    res.json({
      success: true,
      requirePasswordAuth: rolesService.isPasswordRequired()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/settings/toggle-password
 * Toggle global password authentication requirement
 */
router.post('/settings/toggle-password', (req, res, next) => {
  try {
    const { enabled } = req.body;
    const currentState = rolesService.setPasswordRequirement(Boolean(enabled));
    res.json({
      success: true,
      requirePasswordAuth: currentState,
      message: currentState
        ? 'Password authentication is now strictly enforced on user switch.'
        : 'Password authentication disabled. User switching is now frictionless.'
    });
  } catch (err) {
    next(err);
  }
});

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

    const isValid = verifySecret(pin, user.pin_code) || (user.password_hash && verifySecret(pin, user.password_hash));
    if (!isValid) {
      throw new AppError('Invalid PIN code', 401);
    }

    const profile = rolesService.getUserProfile(user.id);
    const token = createToken({
      id: user.id,
      userName: user.user_name,
      role: user.role_code || user.role,
      level: profile.role_level || 5
    }, 86400 * 7);

    res.json({
      success: true,
      token,
      user: profile
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 * Profile check for authenticated session with role permissions and hierarchy
 */
router.get('/me', authenticate, (req, res) => {
  const profile = rolesService.getUserProfile(req.user.id);
  res.json({
    success: true,
    user: profile || req.user
  });
});

/**
 * GET /api/auth/users
 * List all active users with role, supervisor, and department
 */
router.get('/users', (req, res, next) => {
  try {
    const users = rolesService.listUsers();
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
