const express = require('express');
const router = express.Router();
const db = require('../db');
const inventoryService = require('../services/inventory.service');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/inventory/stats
 * Dashboard overview metrics
 */
router.get('/stats', (req, res, next) => {
  try {
    const totalRolls = db.get('SELECT count(*) as count FROM fabric_bundles');
    const totalFabricKg = db.get("SELECT coalesce(sum(available_qty), 0) as total FROM fabric_bundles WHERE material_sub_type = 'Fabric'");
    const totalLots = db.get('SELECT count(*) as count FROM parent_inward_lots');
    const totalAccessories = db.get('SELECT count(*) as count FROM accessory_items');
    const pendingQc = db.get("SELECT count(*) as count FROM fabric_bundles WHERE qc_status = 'PENDING'");
    const totalLedgerTxns = db.get('SELECT count(*) as count FROM inventory_stock_ledger');

    const recentTxns = db.query(`
      SELECT id, txn_date, txn_type, parent_code, bundle_code, production_order_no, 
             item_name, color_name, qty_in, qty_out, balance_after, location_bin, performed_by
      FROM inventory_stock_ledger 
      ORDER BY txn_date DESC LIMIT 10
    `);

    res.json({
      success: true,
      data: {
        totalRolls: totalRolls.count,
        totalFabricKg: Number(totalFabricKg.total.toFixed(3)),
        totalLots: totalLots.count,
        totalAccessories: totalAccessories.count,
        pendingQc: pendingQc.count,
        totalLedgerTxns: totalLedgerTxns.count,
        recentTxns
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/inventory/next-parent-code
 * Suggest next sequential parent lot code for today
 */
router.get('/next-parent-code', (req, res, next) => {
  try {
    const suggestion = inventoryService.suggestNextParentCode();
    res.json({ success: true, ...suggestion });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/inventory/lots
 * List parent inward lots
 */
router.get('/lots', (req, res, next) => {
  try {
    const lots = db.query(`
      SELECT p.*, e.name as vendor_name,
        (SELECT count(*) FROM fabric_bundles WHERE parent_code = p.parent_code) as bundle_count,
        (SELECT coalesce(sum(available_qty), 0) FROM fabric_bundles WHERE parent_code = p.parent_code) as current_available_qty
      FROM parent_inward_lots p
      LEFT JOIN entities e ON p.vendor_id = e.id
      ORDER BY p.inward_date DESC, p.parent_code DESC
    `);
    res.json({ success: true, count: lots.length, data: lots });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/inventory/inward
 * Inward parent lot & generate roll bundles
 */
router.post('/inward', authenticate, (req, res, next) => {
  try {
    const result = inventoryService.inwardParentLot({
      ...req.body,
      createdBy: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/inventory/bundles
 * List fabric roll bundles with optional filters
 */
router.get('/bundles', (req, res, next) => {
  try {
    const { status, parentCode, fabricName, colorName, availableOnly } = req.query;
    let sql = 'SELECT * FROM fabric_bundles';
    const params = [];
    const conditions = [];

    if (parentCode) {
      conditions.push('parent_code = ?');
      params.push(parentCode.trim());
    }
    if (fabricName) {
      conditions.push('fabric_name LIKE ?');
      params.push(`%${fabricName.trim()}%`);
    }
    if (colorName) {
      conditions.push('color_name LIKE ?');
      params.push(`%${colorName.trim()}%`);
    }
    if (availableOnly === 'true' || availableOnly === '1') {
      conditions.push('available_qty > 0');
    }
    if (status) {
      conditions.push('qc_status = ?');
      params.push(status.trim());
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC LIMIT 100';

    const bundles = db.query(sql, params);
    res.json({ success: true, count: bundles.length, data: bundles });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/inventory/bundles/:code
 * Get bundle details by bundle_code
 */
router.get('/bundles/:code', (req, res, next) => {
  try {
    const { code } = req.params;
    const bundle = db.get('SELECT * FROM fabric_bundles WHERE bundle_code = ?', [code.trim()]);
    if (!bundle) {
      return res.status(404).json({ success: false, error: `Bundle ${code} not found` });
    }
    res.json({ success: true, data: bundle });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/inventory/issue
 * Issue fabric or accessory to production order
 */
router.post('/issue', authenticate, (req, res, next) => {
  try {
    const result = inventoryService.issueMaterial({
      ...req.body,
      issuedBy: req.user.id,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/inventory/return-remnant
 * Check-in leftover roll remnant from cutting floor
 */
router.post('/return-remnant', authenticate, (req, res, next) => {
  try {
    const result = inventoryService.returnRemnantRoll({
      ...req.body,
      returnedBy: req.user.id,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/inventory/dual-uom
 * Dual UOM conversions (Kg <-> Meters)
 */
router.post('/dual-uom', (req, res, next) => {
  try {
    const result = inventoryService.calculateDualUom(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/inventory/ledger
 * Immutable stock transactions ledger
 */
router.get('/ledger', (req, res, next) => {
  try {
    const { limit, offset, txnType, code } = req.query;
    const txns = inventoryService.getStockLedger({ limit, offset, txnType, code });
    res.json({ success: true, count: txns.length, data: txns });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
