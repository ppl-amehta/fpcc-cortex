const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper to generate sequential codes
function generateSequentialCode(prefix, table, column) {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, ''); // e.g. 261014
  const pattern = `${prefix}-${dateStr}-%`;
  const latest = db.get(`SELECT ${column} as code FROM ${table} WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`, [pattern]);
  let seq = 1;
  if (latest && latest.code) {
    const parts = latest.code.split('-');
    if (parts.length >= 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }
  return `${prefix}-${dateStr}-${String(seq).padStart(2, '0')}`;
}

// ==========================================
// 1. CUTTING TELEMETRY & PALLA AVERAGE ENGINE
// ==========================================

// GET all cutting logs
router.get('/cutting/jobs', (req, res) => {
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
    res.json({ success: true, data: jobs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST log cutting lay with marker palla average & strict validations
router.post('/cutting/lay', (req, res) => {
  try {
    const {
      productionOrderNo,
      bundleCode,
      cutterId = 'usr-santosh',
      layNo = 1,
      layLengthMeters,
      pliesCount,
      samplePallaPcs, // e.g. 6 pcs in marker sample
      samplePallaWeightKg, // e.g. 1.200 kg
      totalFabricWeightUsedKg, // e.g. 36.000 kg
      sizeBreakdown, // object: {"S": 30, "M": 60, "L": 60, "XL": 30}
      targetBomConsumption = 0.220, // 0.220 kg per garment default BOM
      remarks
    } = req.body;

    // Strict Validation 1: Required numerical fields
    if (!productionOrderNo || !bundleCode || !samplePallaPcs || !samplePallaWeightKg || !totalFabricWeightUsedKg || !sizeBreakdown) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required cutting fields (productionOrderNo, bundleCode, samplePallaPcs, samplePallaWeightKg, totalFabricWeightUsedKg, sizeBreakdown)' 
      });
    }

    const pallaPcs = parseInt(samplePallaPcs, 10);
    const pallaWeight = parseFloat(samplePallaWeightKg);
    const totalFabricUsed = parseFloat(totalFabricWeightUsedKg);

    if (pallaPcs <= 0 || pallaWeight <= 0 || totalFabricUsed <= 0) {
      return res.status(400).json({ success: false, error: 'Palla sample pcs, palla weight, and total fabric weight must be greater than zero.' });
    }

    // Strict Validation 2: Size Breakdown consistency
    let totalPcsCut = 0;
    const cleanSizeBreakdown = {};
    for (const [size, count] of Object.entries(sizeBreakdown)) {
      const parsedCount = parseInt(count, 10) || 0;
      if (parsedCount < 0) {
        return res.status(400).json({ success: false, error: `Invalid cut count for size ${size}: cannot be negative` });
      }
      cleanSizeBreakdown[size] = parsedCount;
      totalPcsCut += parsedCount;
    }

    if (totalPcsCut <= 0) {
      return res.status(400).json({ success: false, error: 'Total cut pieces must be greater than zero.' });
    }

    // Calculation 1: Palla Average & Actual Consumption
    const calculatedPallaAvgKg = Number((pallaWeight / pallaPcs).toFixed(4));
    const actualConsumptionPerPc = Number((totalFabricUsed / totalPcsCut).toFixed(4));
    const plannedBom = parseFloat(targetBomConsumption) || 0.220;
    const variancePct = Number((((actualConsumptionPerPc - plannedBom) / plannedBom) * 100).toFixed(2));

    // Execute atomic transaction
    const result = db.transaction(() => {
      // Check Order exists
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
      if (!order) {
        throw new Error(`Production Order ${productionOrderNo} does not exist`);
      }

      // Check Bundle exists
      const bundle = db.get('SELECT * FROM fabric_bundles WHERE bundle_code = ?', [bundleCode.trim()]);
      if (!bundle) {
        throw new Error(`Fabric bundle ${bundleCode} not found in warehouse`);
      }

      // Check if fabric has been issued or has enough weight
      const cutJobNo = generateSequentialCode('CUT', 'cutting_jobs', 'cut_job_no');
      const cutJobId = `cut-${Date.now()}`;

      db.run(`
        INSERT INTO cutting_jobs (
          id, cut_job_no, production_order_no, bundle_code, cutter_id,
          lay_no, lay_length_meters, plies_count, sample_palla_pcs, sample_palla_weight_kg,
          calculated_palla_avg_kg, total_fabric_weight_used_kg, total_pcs_cut,
          size_breakdown_json, actual_consumption_per_pc, target_bom_consumption,
          variance_pct, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        cutJobId, cutJobNo, order.production_order_no, bundle.bundle_code, cutterId,
        layNo || 1, layLengthMeters ? parseFloat(layLengthMeters) : null,
        pliesCount ? parseInt(pliesCount, 10) : null,
        pallaPcs, pallaWeight, calculatedPallaAvgKg, totalFabricUsed, totalPcsCut,
        JSON.stringify(cleanSizeBreakdown), actualConsumptionPerPc, plannedBom,
        variancePct, remarks || null
      ]);

      // Update Order Size Matrix cut quantities
      for (const [size, count] of Object.entries(cleanSizeBreakdown)) {
        if (count > 0) {
          const matrixEntry = db.get('SELECT * FROM order_size_matrix WHERE production_order_id = ? AND size_label = ?', [order.id, size]);
          if (matrixEntry) {
            db.run('UPDATE order_size_matrix SET cut_qty = cut_qty + ? WHERE id = ?', [count, matrixEntry.id]);
          } else {
            const matrixId = `osm-${Date.now()}-${size}`;
            db.run('INSERT INTO order_size_matrix (id, production_order_id, size_label, order_qty, cut_qty) VALUES (?, ?, ?, ?, ?)', 
              [matrixId, order.id, size, 0, count]);
          }
        }
      }

      // Advance order status to 'Cutting' if in planning
      if (order.status === 'Planning' || order.status === 'Material_Allocated') {
        db.run("UPDATE production_orders SET status = 'Cutting' WHERE id = ?", [order.id]);
      }

      return {
        cutJobNo,
        productionOrderNo: order.production_order_no,
        totalPcsCut,
        pallaAverageKg: calculatedPallaAvgKg,
        actualConsumptionPerPc,
        variancePct,
        varianceAlert: variancePct > 5.0 ? `High fabric consumption warning: +${variancePct}% above BOM` : null
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Cutting lay error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// 2. RUNNER LOGISTICS & MATERIAL TRANSIT PASSES
// ==========================================

// GET all transits with optional status or order filter
router.get('/transits', (req, res) => {
  try {
    const { status, orderNo } = req.query;
    let sql = `
      SELECT t.*, 
             r.user_name as runner_name, 
             d.user_name as dispatched_by_name, 
             recv.user_name as received_by_name,
             p.client_name, p.product_name, p.color_name as order_color
      FROM material_transits t
      JOIN users r ON t.runner_id = r.id
      JOIN users d ON t.dispatched_by = d.id
      LEFT JOIN users recv ON t.received_by = recv.id
      JOIN production_orders p ON t.production_order_no = p.production_order_no
    `;
    const params = [];
    const conditions = [];

    if (status) {
      conditions.push('t.transit_status = ?');
      params.push(status.trim());
    }
    if (orderNo) {
      conditions.push('t.production_order_no = ?');
      params.push(orderNo.trim());
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY t.created_at DESC';

    const transits = db.query(sql, params);
    res.json({ success: true, count: transits.length, data: transits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST dispatch material with a runner (Creates Transit Pass)
router.post('/transits/dispatch', (req, res) => {
  try {
    const {
      productionOrderNo,
      sourceStation, // e.g. 'Cutting'
      destStation,   // e.g. 'Branding' or 'Stitching'
      runnerId = 'usr-ramesh',
      itemType = 'Cut_Panels', // 'Fabric_Rolls', 'Cut_Panels', 'Semi_Stitched', 'Finished_Garments', 'Sealed_Cartons'
      itemRef, // e.g. CUT-26001-01 or Bundle code
      dispatchedQty,
      dispatchedBy = 'usr-santosh',
      notes
    } = req.body;

    if (!productionOrderNo || !sourceStation || !destStation || !dispatchedQty || parseInt(dispatchedQty, 10) <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required transit dispatch fields (productionOrderNo, sourceStation, destStation, dispatchedQty > 0)' 
      });
    }

    const qty = parseInt(dispatchedQty, 10);
    const transitPassNo = generateSequentialCode('TRN', 'material_transits', 'transit_pass_no');
    const transitId = `trn-${Date.now()}`;

    db.run(`
      INSERT INTO material_transits (
        id, transit_pass_no, production_order_no, source_station, dest_station,
        runner_id, item_type, item_ref, dispatched_qty, dispatched_by,
        dispatched_at, transit_status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'DISPATCHED', ?)
    `, [
      transitId, transitPassNo, productionOrderNo.trim(), sourceStation.trim(), destStation.trim(),
      runnerId, itemType, itemRef || null, qty, dispatchedBy, notes || null
    ]);

    res.json({
      success: true,
      data: {
        transitPassNo,
        transitId,
        sourceStation,
        destStation,
        dispatchedQty: qty,
        status: 'DISPATCHED'
      }
    });
  } catch (err) {
    console.error('Transit dispatch error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST runner acknowledges pickup (Transition to IN_TRANSIT)
router.post('/transits/pickup', (req, res) => {
  try {
    const { transitPassNo, runnerId = 'usr-ramesh' } = req.body;
    if (!transitPassNo) {
      return res.status(400).json({ success: false, error: 'transitPassNo is required' });
    }

    const transit = db.get('SELECT * FROM material_transits WHERE transit_pass_no = ?', [transitPassNo.trim()]);
    if (!transit) {
      return res.status(404).json({ success: false, error: `Transit pass ${transitPassNo} not found` });
    }

    if (transit.transit_status !== 'DISPATCHED') {
      return res.status(400).json({ success: false, error: `Transit ${transitPassNo} is already in state ${transit.transit_status}` });
    }

    db.run(`
      UPDATE material_transits 
      SET transit_status = 'IN_TRANSIT', picked_up_at = CURRENT_TIMESTAMP, runner_id = ?
      WHERE id = ?
    `, [runnerId, transit.id]);

    res.json({
      success: true,
      data: {
        transitPassNo: transit.transit_pass_no,
        status: 'IN_TRANSIT',
        pickedUpAt: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST destination receiver confirms handover & verifies count
// (Tightly validated: checks for transit loss, raises discrepancy alarm if count mismatch)
router.post('/transits/receive', (req, res) => {
  try {
    const {
      transitPassNo,
      receivedQty,
      receivedBy = 'usr-suresh',
      discrepancyReason,
      notes
    } = req.body;

    if (!transitPassNo || receivedQty === undefined || receivedQty === null) {
      return res.status(400).json({ success: false, error: 'transitPassNo and receivedQty are required' });
    }

    const qty = parseInt(receivedQty, 10);
    if (qty < 0) {
      return res.status(400).json({ success: false, error: 'receivedQty cannot be negative' });
    }

    const result = db.transaction(() => {
      const transit = db.get('SELECT * FROM material_transits WHERE transit_pass_no = ?', [transitPassNo.trim()]);
      if (!transit) {
        throw new Error(`Transit pass ${transitPassNo} not found`);
      }

      if (transit.transit_status === 'DELIVERED_VERIFIED') {
        throw new Error(`Transit ${transitPassNo} has already been verified and delivered.`);
      }

      const variance = transit.dispatched_qty - qty;
      const isDiscrepancy = variance !== 0;
      const finalStatus = isDiscrepancy ? 'DISCREPANCY_FLAGGED' : 'DELIVERED_VERIFIED';

      if (isDiscrepancy && !discrepancyReason) {
        throw new Error(`Count discrepancy detected: Sent ${transit.dispatched_qty} pcs, but received ${qty} pcs (Variance: ${variance} pcs). A discrepancy explanation is mandatory!`);
      }

      db.run(`
        UPDATE material_transits 
        SET received_qty = ?, received_by = ?, received_at = CURRENT_TIMESTAMP,
            transit_status = ?, variance_qty = ?, discrepancy_reason = ?,
            notes = coalesce(notes, '') || ' ' || coalesce(?, '')
        WHERE id = ?
      `, [
        qty, receivedBy, finalStatus, variance,
        discrepancyReason || (isDiscrepancy ? 'Quantity mismatch during handover' : null),
        notes || '', transit.id
      ]);

      return {
        transitPassNo: transit.transit_pass_no,
        sourceStation: transit.source_station,
        destStation: transit.dest_station,
        dispatchedQty: transit.dispatched_qty,
        receivedQty: qty,
        variance,
        status: finalStatus,
        discrepancyAlert: isDiscrepancy ? `ALERT: Discrepancy of ${Math.abs(variance)} pcs logged for runner handover!` : null
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Transit receive error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// 3. SUBCONTRACTOR CHALLANS (BRANDING / MACHINE)
// ==========================================

// GET all challans
router.get('/challans', (req, res) => {
  try {
    const { orderNo, status } = req.query;
    let sql = `
      SELECT ch.*, e.name as vendor_name, e.contact_person, e.phone,
             p.client_name, p.product_name, p.color_name as order_color,
             u1.user_name as created_by_name,
             u2.user_name as received_by_name
      FROM subcontractor_challans ch
      JOIN entities e ON ch.vendor_id = e.id
      JOIN production_orders p ON ch.production_order_no = p.production_order_no
      LEFT JOIN users u1 ON ch.created_by = u1.id
      LEFT JOIN users u2 ON ch.received_by = u2.id
    `;
    const params = [];
    const conditions = [];

    if (orderNo) {
      conditions.push('ch.production_order_no = ?');
      params.push(orderNo.trim());
    }
    if (status) {
      conditions.push('ch.status = ?');
      params.push(status.trim());
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY ch.date_sent DESC';

    const challans = db.query(sql, params);
    res.json({ success: true, count: challans.length, data: challans });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST dispatch challan to vendor
router.post('/challans/dispatch', (req, res) => {
  try {
    const {
      productionOrderNo,
      vendorId,
      processType = 'Branding', // 'Branding', 'Stitching', 'Washing'
      brandingType = 'Screen_Print', // 'Screen_Print', 'Embroidery', 'DTF', 'Heatseal'
      panelName = 'Front_Chest',
      qtySent,
      expectedEta,
      createdBy = 'usr-meenakshi',
      remarks
    } = req.body;

    if (!productionOrderNo || !vendorId || !qtySent || parseInt(qtySent, 10) <= 0) {
      return res.status(400).json({ success: false, error: 'Missing required challan fields (productionOrderNo, vendorId, qtySent > 0)' });
    }

    const qty = parseInt(qtySent, 10);
    const challanNo = generateSequentialCode('CH', 'subcontractor_challans', 'challan_no');
    const challanId = `ch-${Date.now()}`;

    db.run(`
      INSERT INTO subcontractor_challans (
        id, challan_no, production_order_no, vendor_id, process_type,
        branding_type, panel_name, qty_sent, date_sent, expected_eta,
        status, created_by, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'Dispatched', ?, ?)
    `, [
      challanId, challanNo, productionOrderNo.trim(), vendorId, processType,
      brandingType, panelName, qty, expectedEta || null, createdBy, remarks || null
    ]);

    res.json({
      success: true,
      data: {
        challanNo,
        productionOrderNo,
        qtySent: qty,
        status: 'Dispatched'
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST receive panels from subcontractor with rejection & defect tracking
router.post('/challans/receive', (req, res) => {
  try {
    const {
      challanNo,
      qtyReceived,
      rejectionQty = 0,
      rejectionReason,
      reworkQty = 0,
      defectPhotoUrl,
      receivedBy = 'usr-aniket',
      remarks
    } = req.body;

    if (!challanNo || qtyReceived === undefined || qtyReceived === null) {
      return res.status(400).json({ success: false, error: 'challanNo and qtyReceived are required' });
    }

    const recQty = parseInt(qtyReceived, 10);
    const rejQty = parseInt(rejectionQty, 10) || 0;
    const rewQty = parseInt(reworkQty, 10) || 0;

    const result = db.transaction(() => {
      const challan = db.get('SELECT * FROM subcontractor_challans WHERE challan_no = ?', [challanNo.trim()]);
      if (!challan) {
        throw new Error(`Challan ${challanNo} not found`);
      }

      if (rejQty > 0 && !rejectionReason) {
        throw new Error('Rejection quantity was logged. A reason for rejection is strictly required for vendor audit.');
      }

      const totalAccounted = (challan.qty_received || 0) + recQty + rejQty + rewQty;
      const isComplete = totalAccounted >= challan.qty_sent;
      const status = rewQty > 0 ? 'Rework_Pending' : (isComplete ? 'Completed' : 'Partially_Received');

      db.run(`
        UPDATE subcontractor_challans
        SET qty_received = qty_received + ?,
            rejection_qty = rejection_qty + ?,
            rejection_reason = coalesce(?, rejection_reason),
            rework_qty = rework_qty + ?,
            actual_received_date = CURRENT_TIMESTAMP,
            defect_photo_url = coalesce(?, defect_photo_url),
            received_by = ?,
            status = ?,
            remarks = coalesce(remarks, '') || ' ' || coalesce(?, '')
        WHERE id = ?
      `, [
        recQty, rejQty, rejectionReason || null, rewQty,
        defectPhotoUrl || null, receivedBy, status, remarks || '', challan.id
      ]);

      return {
        challanNo: challan.challan_no,
        qtySent: challan.qty_sent,
        newReceivedTotal: (challan.qty_received || 0) + recQty,
        totalRejections: (challan.rejection_qty || 0) + rejQty,
        reworkRequired: (challan.rework_qty || 0) + rewQty,
        status
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Challan receive error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// 4. FLOOR PROCESS TELEMETRY (STITCHING, FINISHING & QC)
// ==========================================

// GET process logs
router.get('/process-logs', (req, res) => {
  try {
    const { orderNo, processName } = req.query;
    let sql = `
      SELECT f.*, u.user_name as operator_name, p.client_name, p.product_name, p.color_name as order_color
      FROM floor_process_logs f
      JOIN users u ON f.operator_id = u.id
      JOIN production_orders p ON f.production_order_no = p.production_order_no
    `;
    const params = [];
    const conditions = [];

    if (orderNo) {
      conditions.push('f.production_order_no = ?');
      params.push(orderNo.trim());
    }
    if (processName) {
      conditions.push('f.process_name = ?');
      params.push(processName.trim());
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY f.created_at DESC';

    const logs = db.query(sql, params);
    res.json({ success: true, count: logs.length, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST log daily operation telemetry (Stitching, T/C, Kaaj, Button, Ironing, QC)
router.post('/process-logs', (req, res) => {
  try {
    const {
      productionOrderNo,
      processName, // 'Stitching', 'Thread_Cutting', 'Kaaj', 'Button', 'Eyelet', 'Bartack', 'Heatseal', 'Ironing', 'QC_Inspection'
      operatorId = 'usr-dilip',
      stationCode = 'LINE-1',
      completedQty,
      rejectedQty = 0,
      reworkQty = 0,
      defectCategory,
      sizeBreakdown, // optional
      remarks
    } = req.body;

    if (!productionOrderNo || !processName || completedQty === undefined || completedQty === null) {
      return res.status(400).json({ success: false, error: 'Missing required telemetry fields (productionOrderNo, processName, completedQty)' });
    }

    const completed = parseInt(completedQty, 10);
    const rejected = parseInt(rejectedQty, 10) || 0;
    const rework = parseInt(reworkQty, 10) || 0;

    if (completed < 0 || rejected < 0 || rework < 0) {
      return res.status(400).json({ success: false, error: 'Quantities cannot be negative' });
    }

    const result = db.transaction(() => {
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
      if (!order) {
        throw new Error(`Production Order ${productionOrderNo} not found`);
      }

      const logId = `proc-${Date.now()}`;
      db.run(`
        INSERT INTO floor_process_logs (
          id, production_order_no, process_name, operator_id, station_code,
          completed_qty, rejected_qty, rework_qty, defect_category,
          size_breakdown_json, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        logId, order.production_order_no, processName.trim(), operatorId,
        stationCode || 'DEFAULT', completed, rejected, rework,
        defectCategory || null, sizeBreakdown ? JSON.stringify(sizeBreakdown) : null,
        remarks || null
      ]);

      // If Stitching or Finishing, update order size matrix finished counts
      if (processName === 'Stitching' && sizeBreakdown) {
        for (const [size, count] of Object.entries(sizeBreakdown)) {
          const parsed = parseInt(count, 10) || 0;
          if (parsed > 0) {
            db.run('UPDATE order_size_matrix SET finished_qty = finished_qty + ? WHERE production_order_id = ? AND size_label = ?', 
              [parsed, order.id, size]);
          }
        }
      }

      return {
        logId,
        processName,
        completedQty: completed,
        rejectedQty: rejected,
        reworkQty: rework
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Process log error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// 5. CARTON PACKING & SHIPMENT TELEMETRY
// ==========================================

// GET cartons
router.get('/cartons', (req, res) => {
  try {
    const { orderNo } = req.query;
    let sql = `
      SELECT c.*, u.user_name as packed_by_name, p.client_name, p.product_name, p.color_name as order_color
      FROM carton_packings c
      JOIN users u ON c.packed_by = u.id
      JOIN production_orders p ON c.production_order_no = p.production_order_no
    `;
    const params = [];
    if (orderNo) {
      sql += ' WHERE c.production_order_no = ?';
      params.push(orderNo.trim());
    }
    sql += ' ORDER BY c.created_at DESC';
    const cartons = db.query(sql, params);
    res.json({ success: true, count: cartons.length, data: cartons });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST pack carton
router.post('/cartons/pack', (req, res) => {
  try {
    const {
      productionOrderNo,
      boxType = '7-Ply Heavy Master Box',
      grossWeightKg,
      sizeBreakdown, // {"S": 10, "M": 20, "L": 20}
      packedBy = 'usr-rohit',
      destinationAddress,
      remarks
    } = req.body;

    if (!productionOrderNo || !sizeBreakdown) {
      return res.status(400).json({ success: false, error: 'productionOrderNo and sizeBreakdown are required' });
    }

    let totalPcs = 0;
    const cleanSizes = {};
    for (const [s, c] of Object.entries(sizeBreakdown)) {
      const count = parseInt(c, 10) || 0;
      cleanSizes[s] = count;
      totalPcs += count;
    }

    if (totalPcs <= 0) {
      return res.status(400).json({ success: false, error: 'Total packed pieces must be greater than zero' });
    }

    const result = db.transaction(() => {
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
      if (!order) {
        throw new Error(`Production Order ${productionOrderNo} not found`);
      }

      const cartonNo = generateSequentialCode('BOX', 'carton_packings', 'carton_no');
      const cartonId = `box-${Date.now()}`;

      db.run(`
        INSERT INTO carton_packings (
          id, carton_no, production_order_no, box_type, gross_weight_kg,
          size_breakdown_json, total_pcs, packed_by, status, destination_address, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Sealed', ?, ?)
      `, [
        cartonId, cartonNo, order.production_order_no, boxType,
        grossWeightKg ? parseFloat(grossWeightKg) : null,
        JSON.stringify(cleanSizes), totalPcs, packedBy,
        destinationAddress || null, remarks || null
      ]);

      // Update packed_qty in order_size_matrix
      for (const [s, count] of Object.entries(cleanSizes)) {
        if (count > 0) {
          db.run('UPDATE order_size_matrix SET packed_qty = packed_qty + ? WHERE production_order_id = ? AND size_label = ?', 
            [count, order.id, s]);
        }
      }

      return {
        cartonNo,
        totalPcs,
        status: 'Sealed'
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Carton pack error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// 6. MANAGER OPERATIONS RADAR & PROGRESS MATRIX
// ==========================================

router.get('/radar', (req, res) => {
  try {
    // 1. Order-by-order stage funnel
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

    // 2. Active Runner Transits (In-Transit or Dispatched)
    const activeTransits = db.query(`
      SELECT t.*, r.user_name as runner_name, p.client_name, p.product_name
      FROM material_transits t
      JOIN users r ON t.runner_id = r.id
      JOIN production_orders p ON t.production_order_no = p.production_order_no
      WHERE t.transit_status IN ('DISPATCHED', 'IN_TRANSIT')
      ORDER BY t.dispatched_at ASC
    `);

    // 3. Discrepancies Flagged
    const flaggedDiscrepancies = db.query(`
      SELECT t.*, r.user_name as runner_name, p.client_name, p.product_name
      FROM material_transits t
      JOIN users r ON t.runner_id = r.id
      JOIN production_orders p ON t.production_order_no = p.production_order_no
      WHERE t.transit_status = 'DISCREPANCY_FLAGGED'
      ORDER BY t.received_at DESC LIMIT 5
    `);

    // 4. Departmental Rejection Pareto
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

    // 5. Fabric Yield & Palla Variance Overview
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
    console.error('Radar error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
