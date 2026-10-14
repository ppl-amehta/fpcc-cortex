const express = require('express');
const router = express.Router();
const crmService = require('../services/crm.service');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/crm/inquiries
 * List all client inquiries
 */
router.get('/inquiries', (req, res, next) => {
  try {
    const { status, limit } = req.query;
    const inquiries = crmService.listInquiries({ status, limit });
    res.json({ success: true, count: inquiries.length, data: inquiries });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/crm/inquiries
 * Create new inquiry
 */
router.post('/inquiries', authenticate, (req, res, next) => {
  try {
    const result = crmService.createInquiry({
      ...req.body,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/crm/orders/create
 * Native order booking with size breakdown matrix (Zoho replacement)
 */
router.post('/orders/create', authenticate, (req, res, next) => {
  try {
    const result = crmService.createProductionOrder({
      ...req.body,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/crm/orders/:orderNo
 * Get order details across size matrix, operations, and billing
 */
router.get('/orders/:orderNo', (req, res, next) => {
  try {
    const { orderNo } = req.params;
    const details = crmService.getOrderDetails(orderNo);
    res.json({ success: true, data: details });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
