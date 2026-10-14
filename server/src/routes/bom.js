const express = require('express');
const router = express.Router();
const bomService = require('../services/bom.service');
const { authenticate, requirePermission } = require('../middleware/auth');

/**
 * GET /api/bom/templates
 * List all standard garment BOM recipe templates
 */
router.get('/templates', (req, res, next) => {
  try {
    const templates = bomService.listTemplates();
    res.json({ success: true, count: templates.length, data: templates });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/bom/templates/:category
 * Get template for specific category
 */
router.get('/templates/:category', (req, res, next) => {
  try {
    const { category } = req.params;
    const { subCategory } = req.query;
    const template = bomService.getTemplate(category, subCategory);
    if (!template) {
      return res.status(404).json({ success: false, error: `No BOM template found for category '${category}'` });
    }
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bom/templates
 * Create or update a BOM recipe template
 */
router.post('/templates', authenticate, (req, res, next) => {
  try {
    const template = bomService.upsertTemplate(req.body);
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bom/explode
 * Simulate BOM explosion without committing to DB
 */
router.post('/explode', (req, res, next) => {
  try {
    const { productCategory, subCategory, totalPieces, sizeMatrix, customSpecs } = req.body;
    if (!productCategory || !totalPieces) {
      return res.status(400).json({ success: false, error: 'productCategory and totalPieces are required' });
    }
    const exploded = bomService.explodeBOM({
      productCategory,
      subCategory,
      totalPieces,
      sizeMatrix,
      customSpecs
    });
    res.json({ success: true, data: exploded });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bom/orders/:orderNo/allocate
 * Trigger full production BOM explosion, stock check, shortfall calculation, and PO generation
 */
router.post('/orders/:orderNo/allocate', authenticate, (req, res, next) => {
  try {
    const { orderNo } = req.params;
    const { autoCreateShortfallPO = true, vendorId = null } = req.body;
    const result = bomService.allocateOrderBOM(orderNo, {
      autoCreateShortfallPO,
      vendorId,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/bom/orders/:orderNo/allocations
 * View current BOM allocations and shortfall status for an order
 */
router.get('/orders/:orderNo/allocations', (req, res, next) => {
  try {
    const { orderNo } = req.params;
    const allocations = bomService.getOrderAllocations(orderNo);
    res.json({ success: true, count: allocations.length, data: allocations });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
