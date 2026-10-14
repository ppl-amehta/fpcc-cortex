const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsapp.service');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/whatsapp/logs
 * Audit history of all WhatsApp dispatches and incoming ChatOps commands
 */
router.get('/logs', (req, res, next) => {
  try {
    const { direction, limit } = req.query;
    const logs = whatsappService.getLogs({ direction, limit });
    res.json({ success: true, count: logs.length, data: logs });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/whatsapp/send
 * Outbound notification dispatch
 */
router.post('/send', authenticate, (req, res, next) => {
  try {
    const result = whatsappService.sendNotification(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/whatsapp/webhook
 * 2-way interactive ChatOps webhook (Meta Cloud API / Twilio / Direct Simulation)
 */
router.post('/webhook', (req, res, next) => {
  try {
    const fromNumber = req.body.from || req.body.phoneNumber || req.body.sender || '919822233445';
    const senderName = req.body.senderName || req.body.pushName || 'Floor Worker';
    const messageText = (req.body.body || req.body.message || req.body.text || '').trim();

    const result = whatsappService.processChatOpsCommand({
      fromNumber,
      senderName,
      messageText
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
