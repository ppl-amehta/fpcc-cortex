const express = require('express');
const router = express.Router();
const db = require('../db');
const cuttingService = require('../services/cutting.service');
const runnerService = require('../services/runner.service');
const subcontractorService = require('../services/subcontractor.service');
const floorService = require('../services/floor.service');
const packingService = require('../services/packing.service');
const { authenticate } = require('../middleware/auth');

// ==========================================
// 1. CUTTING TELEMETRY & PALLA AVERAGE ENGINE
// ==========================================

router.get('/cutting/jobs', (req, res, next) => {
  try {
    const { orderNo } = req.query;
    let sql = `
      SELECT c.*, u.user_name as cutter_name, p.client_name, p.product_name, p.color_name as order_color
      FROM cutting_jobs c
      JOIN users u ON c.cutter_id = u.id
      JOIN production_orders p ON c.production_order_no = p.production_order_no
    `;
    const params = [];
    if (orderNo) {
      sql += ' WHERE c.production_order_no = ?';
      params.push(orderNo.trim());
    }
    sql += ' ORDER BY c.created_at DESC';
    const jobs = db.query(sql, params);
    res.json({ success: true, count: jobs.length, data: jobs });
  } catch (err) {
    next(err);
  }
});

router.post('/cutting/lay', authenticate, (req, res, next) => {
  try {
    const result = cuttingService.recordLay({
      ...req.body,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// 2. RUNNER LOGISTICS & MATERIAL TRANSIT PASSES
// ==========================================

router.get('/transits', (req, res, next) => {
  try {
    const { status, orderNo, runnerId } = req.query;
    const transits = runnerService.listTransits({ status, orderNo, runnerId });
    res.json({ success: true, count: transits.length, data: transits });
  } catch (err) {
    next(err);
  }
});

router.post('/transits/dispatch', authenticate, (req, res, next) => {
  try {
    const result = runnerService.dispatch({
      ...req.body,
      dispatchedBy: req.body.dispatchedBy || req.user.id,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/transits/pickup', authenticate, (req, res, next) => {
  try {
    const { transitPassNo, runnerId } = req.body;
    const result = runnerService.pickup({
      transitPassNo,
      runnerId: runnerId || req.user.id,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/transits/receive', authenticate, (req, res, next) => {
  try {
    const { transitPassNo, receivedQty, receivedBy, discrepancyReason, notes } = req.body;
    const result = runnerService.receiveHandover({
      transitPassNo,
      receivedQty,
      receivedBy: receivedBy || req.user.id,
      discrepancyReason,
      notes,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// 3. SUBCONTRACTOR CHALLANS & REJECTIONS
// ==========================================

router.get('/challans', (req, res, next) => {
  try {
    const { orderNo, status, vendorId } = req.query;
    const challans = subcontractorService.listChallans({ orderNo, status, vendorId });
    res.json({ success: true, count: challans.length, data: challans });
  } catch (err) {
    next(err);
  }
});

router.post('/challans/dispatch', authenticate, (req, res, next) => {
  try {
    const result = subcontractorService.dispatchChallan({
      ...req.body,
      createdBy: req.body.createdBy || req.user.id,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/challans/receive', authenticate, (req, res, next) => {
  try {
    const result = subcontractorService.receivePanels({
      ...req.body,
      receivedBy: req.body.receivedBy || req.user.id,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/subcontractors/debit-notes', (req, res, next) => {
  try {
    const { vendorId } = req.query;
    const notes = subcontractorService.listDebitNotes({ vendorId });
    res.json({ success: true, count: notes.length, data: notes });
  } catch (err) {
    next(err);
  }
});

router.get('/remakes', (req, res, next) => {
  try {
    const { status } = req.query;
    const remakes = subcontractorService.listRemakeWorkOrders({ status });
    res.json({ success: true, count: remakes.length, data: remakes });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 4. FLOOR PROCESS TELEMETRY (STITCHING & QC)
// ==========================================

router.get('/process-logs', (req, res, next) => {
  try {
    const { orderNo, processName, limit } = req.query;
    const logs = floorService.getProcessLogs({ orderNo, processName, limit });
    res.json({ success: true, count: logs.length, data: logs });
  } catch (err) {
    next(err);
  }
});

router.post('/process-logs', authenticate, (req, res, next) => {
  try {
    const result = floorService.logTelemetry({
      ...req.body,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/defects/pareto', (req, res, next) => {
  try {
    const { orderNo } = req.query;
    const pareto = floorService.getDefectPareto({ orderNo });
    res.json({ success: true, count: pareto.length, data: pareto });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 5. CARTON PACKING & SHIPMENT TELEMETRY
// ==========================================

router.get('/cartons', (req, res, next) => {
  try {
    const { orderNo, status, limit } = req.query;
    const cartons = packingService.getCartons({ orderNo, status, limit });
    res.json({ success: true, count: cartons.length, data: cartons });
  } catch (err) {
    next(err);
  }
});

router.post('/cartons/pack', authenticate, (req, res, next) => {
  try {
    const result = packingService.packCarton({
      ...req.body,
      userId: req.user.id
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/cartons/manifest/:orderNo', (req, res, next) => {
  try {
    const { orderNo } = req.params;
    const manifest = packingService.getPackingManifest(orderNo);
    res.json({ success: true, data: manifest });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 6. MANAGER OPERATIONS RADAR & PROGRESS MATRIX
// ==========================================

router.get('/radar', (req, res, next) => {
  try {
    const orders = db.query(`
      SELECT p.id, p.production_order_no, p.sales_order_no, p.client_name, p.product_name, p.color_name,
             p.total_qty as planned_qty, p.status, p.target_etd,
             coalesce((SELECT sum(total_pcs_cut) FROM cutting_jobs WHERE production_order_no = p.production_order_no), 0) as cut_qty,
             coalesce((SELECT sum(qty_sent) FROM subcontractor_challans WHERE production_order_no = p.production_order_no AND status != 'Completed'), 0) as at_branding_qty,
             coalesce((SELECT sum(qty_received) FROM subcontractor_challans WHERE production_order_no = p.production_order_no), 0) as branded_recd_qty,
             coalesce((SELECT sum(completed_qty) FROM floor_process_logs WHERE production_order_no = p.production_order_no AND process_name = 'Stitching'), 0) as stitched_qty,
             coalesce((SELECT sum(completed_qty) FROM floor_process_logs WHERE production_order_no = p.production_order_no AND process_name = 'QC_Inspection'), 0) as qc_passed_qty,
             coalesce((SELECT sum(total_pcs) FROM carton_packings WHERE production_order_no = p.production_order_no), 0) as packed_qty
      FROM production_orders p
      ORDER BY p.created_at DESC
    `);

    const activeTransits = db.query(`
      SELECT t.*, r.user_name as runner_name, p.client_name, p.product_name
      FROM material_transits t
      JOIN users r ON t.runner_id = r.id
      JOIN production_orders p ON t.production_order_no = p.production_order_no
      WHERE t.transit_status IN ('DISPATCHED', 'IN_TRANSIT')
      ORDER BY t.dispatched_at ASC
    `);

    const flaggedDiscrepancies = db.query(`
      SELECT t.*, r.user_name as runner_name, p.client_name, p.product_name
      FROM material_transits t
      JOIN users r ON t.runner_id = r.id
      JOIN production_orders p ON t.production_order_no = p.production_order_no
      WHERE t.transit_status = 'DISCREPANCY_FLAGGED'
      ORDER BY t.received_at DESC LIMIT 5
    `);

    const floorRejections = db.query(`
      SELECT process_name as department, sum(rejected_qty) as rejected_pcs, sum(rework_qty) as rework_pcs
      FROM floor_process_logs
      GROUP BY process_name
      HAVING sum(rejected_qty) > 0 OR sum(rework_qty) > 0
    `);

    const subcontractorRejections = db.query(`
      SELECT process_type as department, sum(rejection_qty) as rejected_pcs, sum(rework_qty) as rework_pcs
      FROM subcontractor_challans
      GROUP BY process_type
      HAVING sum(rejection_qty) > 0 OR sum(rework_qty) > 0
    `);

    const cuttingVariances = db.query(`
      SELECT production_order_no, round(avg(actual_consumption_per_pc), 4) as avg_actual_consumption,
             round(avg(target_bom_consumption), 4) as bom_target,
             round(avg(variance_pct), 2) as avg_variance_pct,
             sum(total_pcs_cut) as total_cut_pcs,
             sum(total_fabric_weight_used_kg) as total_kg_used
      FROM cutting_jobs
      GROUP BY production_order_no
    `);

    res.json({
      success: true,
      data: {
        orders,
        activeTransits,
        flaggedDiscrepancies,
        rejectionPareto: [...floorRejections, ...subcontractorRejections],
        cuttingVariances
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
