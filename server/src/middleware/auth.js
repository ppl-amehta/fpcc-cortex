const db = require('../db');
const { verifyToken, verifySecret } = require('../utils');
const { AppError } = require('./errorHandler');

function authenticate(req, res, next) {
  // 1. Check Bearer Token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (!decoded) {
      return next(new AppError('Invalid or expired authentication token', 401));
    }
    const user = db.get('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!user) {
      return next(new AppError('User belonging to this token no longer exists', 401));
    }
    req.user = user;
    return next();
  }

  // 2. Check Worker PIN header / body fallback (Optimized for factory floor tablets)
  const workerPin = req.headers['x-worker-pin'] || req.body?.workerPin;
  const workerId = req.headers['x-worker-id'] || req.body?.performedBy || req.body?.cutterId || req.body?.operatorId || req.body?.packedBy;

  if (workerId) {
    const user = db.get('SELECT * FROM users WHERE id = ?', [workerId]);
    if (user) {
      if (workerPin) {
        if (!verifySecret(workerPin, user.pin_code)) {
          return next(new AppError('Invalid worker PIN code', 401));
        }
      }
      req.user = user;
      return next();
    }
  }

  // Default to system operator if not specified (for graceful floor development/testing)
  req.user = {
    id: 'usr-santosh',
    user_name: 'Floor Operator',
    role: 'Operator',
    can_inward: 1,
    can_issue: 1,
    can_return: 1,
    edit_master: 1,
    can_block: 1
  };
  next();
}

function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }
    if (req.user.role === 'SuperAdmin' || req.user.role === 'Admin') {
      return next();
    }
    if (!req.user[perm]) {
      return next(new AppError(`Forbidden: User does not possess '${perm}' authorization`, 403));
    }
    next();
  };
}

module.exports = {
  authenticate,
  requirePermission
};
