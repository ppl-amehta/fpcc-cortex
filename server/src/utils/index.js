const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');

// Sequential Code Generator (e.g., FPCC-PO-YYMMDD-NN, TRN-YYMMDD-NN)
function generateSequentialCode(prefix, table, column, padLength = 2) {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
  const pattern = `${prefix}-${dateStr}-%`;
  const latest = db.get(`SELECT ${column} as code FROM ${table} WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`, [pattern]);
  let seq = 1;
  if (latest && latest.code) {
    const parts = latest.code.split('-');
    const lastPart = parts[parts.length - 1];
    const parsed = parseInt(lastPart, 10);
    if (!isNaN(parsed)) {
      seq = parsed + 1;
    }
  }
  return `${prefix}-${dateStr}-${String(seq).padStart(padLength, '0')}`;
}

// Math Rounding to Decimals
function round(value, decimals = 2) {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Number(Math.round(Number(num + 'e' + decimals)) + 'e-' + decimals);
}

// Token generator & verification using built-in HMAC SHA-256 (Zero npm dependencies)
function createToken(payload, expiresInMs = 7 * 24 * 60 * 60 * 1000) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Date.now() + expiresInMs;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.jwtSecret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', config.jwtSecret)
    .update(`${header}.${body}`)
    .digest('base64url');
  
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}

// Hash PIN / Password using PBKDF2
function hashSecret(secret, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(secret, salt, 10000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifySecret(secret, storedHash) {
  if (!storedHash || !storedHash.includes(':')) {
    // Plaintext fallback for initial seeded pins (e.g. '1111', '9901')
    return secret === storedHash;
  }
  const [salt, origHash] = storedHash.split(':');
  const hash = crypto.pbkdf2Sync(secret, salt, 10000, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(origHash));
}

module.exports = {
  generateSequentialCode,
  round,
  createToken,
  verifyToken,
  hashSecret,
  verifySecret
};
