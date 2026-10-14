const path = require('node:path');

const config = {
  env: process.env.NODE_ENV || 'production',
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'fpcc-cortex-apex-secret-key-2026-frontier',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../../../data/fpcc_cortex.db'),
  whatsapp: {
    provider: process.env.WHATSAPP_PROVIDER || 'simulator', // 'simulator', 'evolution', 'meta'
    endpoint: process.env.WHATSAPP_ENDPOINT || '',
    apiKey: process.env.WHATSAPP_API_KEY || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    defaultSender: process.env.WHATSAPP_DEFAULT_SENDER || '919822233445'
  },
  costing: {
    mrpMultiplier: 4.0,
    rejectionBufferPct: 5.0,
    gstApparelLowerLimit: 2500.0,
    gstRateLowerPct: 5.0,
    gstRateHigherPct: 12.0,
    gstRateServicesPct: 18.0
  }
};

module.exports = config;
