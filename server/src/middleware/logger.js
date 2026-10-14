const crypto = require('node:crypto');

function requestLogger(req, res, next) {
  const start = Date.now();
  req.requestId = req.headers['x-request-id'] || `req-${crypto.randomBytes(4).toString('hex')}`;
  res.setHeader('x-request-id', req.requestId);

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.originalUrl !== '/api/health') {
      const statusColor = res.statusCode >= 400 ? '❌' : '✓';
      console.log(`${statusColor} [${req.method}] ${req.originalUrl} ${res.statusCode} - ${duration}ms (${req.requestId})`);
    }
  });

  next();
}

requestLogger.requestLogger = requestLogger;
requestLogger.correlationLogger = requestLogger;

module.exports = requestLogger;
