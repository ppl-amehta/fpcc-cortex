const express = require('express');
const router = express.Router();
const purchasingService = require('../services/purchasing.service');
const { authenticate, requirePermission } = require('../middleware/auth');

/**
 * GET /api/purchasing/orders
 * List purchase orders with optional status or vendor filter
 */
router.get('/orders', (req, res, next) => {
  try {
    const { status, vendorId, limit } = req.query;
    const orders = purchasingService.listPurchaseOrders({ status, vendorId, limit });
    res.json({ success: true, count: orders.length, data: orders });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/purchasing/orders/:poNo
 * Get purchase order details and line items
 */
router.get('/orders/:poNo', (req, res, next) => {
  try {
    const { poNo } = req.params;
    const po = purchasingService.getPurchaseOrder(poNo);
    res.json({ success: true, data: po });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/purchasing/orders
 * Create new purchase order with line items
 */
router.post('/orders', authenticate, (req, res, next) => {
  try {
    const result = purchasingService.createPurchaseOrder({
      ...req.body,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/purchasing/orders/:poNo/approve
 * Executive authorization of purchase order
 */
router.post('/orders/:poNo/approve', authenticate, (req, res, next) => {
  try {
    const { poNo } = req.params;
    const result = purchasingService.approvePurchaseOrder(poNo, {
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/purchasing/orders/:poNo/receive
 * Reconcile received goods against purchase order items
 */
router.post('/orders/:poNo/receive', authenticate, (req, res, next) => {
  try {
    const { poNo } = req.params;
    const { itemsReceived, invoiceNo, remarks } = req.body;
    const result = purchasingService.receiveGoodsAgainstPO(poNo, {
      itemsReceived,
      invoiceNo,
      remarks,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/purchasing/orders/:poNo/whatsapp
 * Dispatch PO directly to vendor's WhatsApp
 */
router.post('/orders/:poNo/whatsapp', authenticate, (req, res, next) => {
  try {
    const { poNo } = req.params;
    const result = purchasingService.dispatchPOViaWhatsApp(poNo, {
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
