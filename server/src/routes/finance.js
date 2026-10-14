const express = require('express');
const router = express.Router();
const db = require('../db');
const financeService = require('../services/finance.service');
const { authenticate } = require('../middleware/auth');

/**
 * POST /api/finance/costing/calculate
 * 4x MRP Simulator with Indian GST Tier Logic
 */
router.post('/costing/calculate', (req, res, next) => {
  try {
    const result = financeService.calculateCosting(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/finance/costing/save
 * Save formal quotation
 */
router.post('/costing/save', authenticate, (req, res, next) => {
  try {
    const { inquiryId, clientId, clientName, productName, colorName, sampleNo, qty, ...costingParams } = req.body;
    const result = financeService.createQuotation({
      inquiryId,
      clientId,
      clientName,
      productName,
      colorName,
      sampleNo,
      qty,
      costingParams,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/finance/invoices
 * List all invoices
 */
router.get('/invoices', (req, res, next) => {
  try {
    const { status, clientName } = req.query;
    let sql = `
      SELECT i.*, p.product_name, p.color_name, p.total_qty
      FROM invoices i
      JOIN production_orders p ON i.production_order_no = p.production_order_no
    `;
    const params = [];
    const conds = [];
    if (status) {
      conds.push('i.payment_status = ?');
      params.push(status.trim());
    }
    if (clientName) {
      conds.push('i.client_name LIKE ?');
      params.push(`%${clientName.trim()}%`);
    }
    if (conds.length > 0) {
      sql += ' WHERE ' + conds.join(' AND ');
    }
    sql += ' ORDER BY i.created_at DESC';

    const invoices = db.query(sql, params);
    res.json({ success: true, count: invoices.length, data: invoices });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/finance/invoices/generate
 * Issue statutory tax invoice against production order
 */
router.post('/invoices/generate', authenticate, (req, res, next) => {
  try {
    const result = financeService.generateInvoice({
      ...req.body,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/finance/payments/record
 * Record customer payment receipt with UTR reconciliation
 */
router.post('/payments/record', authenticate, (req, res, next) => {
  try {
    const result = financeService.recordPayment({
      ...req.body,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/finance/orders/:orderNo/ocr
 * Generate Order Completion Report (OCR) - Post-Mortem Reconciliation
 */
router.post('/orders/:orderNo/ocr', authenticate, (req, res, next) => {
  try {
    const { orderNo } = req.params;
    const result = financeService.generateOrderCompletionReport(orderNo, {
      closedBy: req.body.closedBy || req.user.id,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/finance/ocr/:orderNo
 * View Order Completion Report
 */
router.get('/ocr/:orderNo', (req, res, next) => {
  try {
    const { orderNo } = req.params;
    const report = db.get('SELECT * FROM order_completion_reports WHERE production_order_no = ?', [orderNo.trim()]);
    if (!report) {
      return res.status(404).json({ success: false, error: `OCR report not found for order ${orderNo}` });
    }
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/finance/summary
 * Financial overview and accounts receivable summary
 */
router.get('/summary', (req, res, next) => {
  try {
    const summary = financeService.getFinancialSummary();
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
