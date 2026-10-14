const db = require('../db');
const { generateSequentialCode, round } = require('../utils');
const { eventBus, EVENTS } = require('./events.service');

const cuttingService = {
  // Record Cutting Lay Telemetry with Master Palla Measurement
  recordLay({
    productionOrderNo,
    bundleCode,
    cutterId = 'usr-santosh',
    layNo = 1,
    layLengthMeters = null,
    pliesCount = null,
    samplePallaPcs = 6,
    samplePallaWeightKg,
    totalFabricWeightUsedKg,
    sizeBreakdown = {}, // {"S": 30, "M": 60, "L": 60, "XL": 30}
    targetBomConsumption = 0.220,
    remarks = null,
    userId = 'system'
  }) {
    if (!productionOrderNo || !bundleCode || !samplePallaWeightKg || !totalFabricWeightUsedKg) {
      throw new Error('productionOrderNo, bundleCode, samplePallaWeightKg, and totalFabricWeightUsedKg are required');
    }

    return db.transaction(() => {
      // 1. Verify Production Order
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
      if (!order) throw new Error(`Production order '${productionOrderNo}' not found`);

      // 2. Verify Roll Bundle & Availability
      const bundle = db.get('SELECT * FROM fabric_bundles WHERE bundle_code = ?', [bundleCode.trim()]);
      if (!bundle) throw new Error(`Fabric roll '${bundleCode}' not found in warehouse`);

      const totalFabUsed = parseFloat(totalFabricWeightUsedKg);

      // Check if fabric is either available on roll or was already issued for this order
      const alreadyIssuedRow = db.get(
        "SELECT coalesce(sum(qty_out), 0) as total FROM inventory_stock_ledger WHERE bundle_code = ? AND production_order_no = ? AND txn_type = 'ISSUE_PRODUCTION'",
        [bundle.bundle_code, order.production_order_no]
      );
      const alreadyIssued = alreadyIssuedRow ? alreadyIssuedRow.total : 0;

      if (alreadyIssued < totalFabUsed && (bundle.available_qty + alreadyIssued) < totalFabUsed) {
        throw new Error(`Insufficient fabric on roll ${bundleCode}: available ${bundle.available_qty} kg, already issued ${alreadyIssued} kg, requested ${totalFabUsed} kg`);
      }

      // Check dye lot color match
      if (bundle.color_name.toLowerCase() !== order.color_name.toLowerCase()) {
        console.warn(`[Cutting Warning] Dye lot color mismatch: Roll is '${bundle.color_name}', Order requires '${order.color_name}'`);
      }

      // 3. Mathematical Telemetry Computations
      const samplePcs = parseInt(samplePallaPcs, 10) || 6;
      const sampleWt = parseFloat(samplePallaWeightKg);
      const calculatedPallaAvgKg = round(sampleWt / samplePcs, 4);

      let totalPcsCut = 0;
      for (const [_, qty] of Object.entries(sizeBreakdown)) {
        totalPcsCut += (parseInt(qty, 10) || 0);
      }
      if (totalPcsCut <= 0) {
        throw new Error('Total pieces cut must be greater than zero across size breakdown');
      }

      const actualConsumptionPerPc = round(totalFabUsed / totalPcsCut, 4);
      const bomTarget = parseFloat(targetBomConsumption) || 0.220;
      const variancePct = round(((actualConsumptionPerPc - bomTarget) / bomTarget) * 100, 2);

      // 4. Generate Sequential Cut Job Code
      const cutJobNo = generateSequentialCode('CUT', 'cutting_jobs', 'cut_job_no');
      const cutId = `cut-${Date.now()}`;

      // 5. Insert Cutting Job
      db.run(`
        INSERT INTO cutting_jobs (
          id, cut_job_no, production_order_no, bundle_code, cutter_id,
          lay_no, lay_length_meters, plies_count, sample_palla_pcs,
          sample_palla_weight_kg, calculated_palla_avg_kg,
          total_fabric_weight_used_kg, total_pcs_cut, size_breakdown_json,
          actual_consumption_per_pc, target_bom_consumption, variance_pct, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        cutId, cutJobNo, order.production_order_no, bundle.bundle_code, cutterId || 'usr-santosh',
        layNo, layLengthMeters, pliesCount, samplePcs, sampleWt, calculatedPallaAvgKg,
        totalFabUsed, totalPcsCut, JSON.stringify(sizeBreakdown), actualConsumptionPerPc,
        bomTarget, variancePct, remarks
      ]);

      // 6. Update Fabric Roll Weight if not already issued
      if (alreadyIssued < totalFabUsed) {
        const neededFromRoll = round(totalFabUsed - alreadyIssued, 3);
        const newRollWeight = round(Math.max(0, bundle.available_qty - neededFromRoll), 3);
        const newIssuedQty = round((bundle.issued_qty || 0) + neededFromRoll, 3);

        db.run('UPDATE fabric_bundles SET available_qty = ?, issued_qty = ? WHERE id = ?',
          [newRollWeight, newIssuedQty, bundle.id]);

        db.run(`
          INSERT INTO inventory_stock_ledger (
            id, txn_date, txn_type, parent_code, bundle_code, production_order_no,
            material_type, item_name, color_name, uom, qty_in, qty_out, balance_after,
            location_bin, performed_by, remarks
          ) VALUES (?, CURRENT_TIMESTAMP, 'ISSUE_PRODUCTION', ?, ?, ?, 'FABRIC', ?, ?, 'Kg', 0, ?, ?, ?, ?, ?)
        `, [
          `tx-${Date.now()}-cut`, bundle.parent_code, bundle.bundle_code, order.production_order_no,
          bundle.fabric_name, bundle.color_name, neededFromRoll, newRollWeight,
          bundle.location_bin, cutterId || 'usr-santosh', `Lay #${layNo}: ${totalPcsCut} pcs cut`
        ]);
      }

      // 7. Update Order Size Matrix
      for (const [sz, qty] of Object.entries(sizeBreakdown)) {
        const count = parseInt(qty, 10) || 0;
        if (count > 0) {
          const matrixEntry = db.get(
            'SELECT id FROM order_size_matrix WHERE production_order_id = ? AND size_label = ?',
            [order.id, sz]
          );
          if (matrixEntry) {
            db.run('UPDATE order_size_matrix SET cut_qty = cut_qty + ? WHERE id = ?', [count, matrixEntry.id]);
          } else {
            db.run(
              'INSERT INTO order_size_matrix (id, production_order_id, size_label, order_qty, cut_qty, finished_qty, packed_qty) VALUES (?, ?, ?, 0, ?, 0, 0)',
              [`osm-${Date.now()}-${sz}`, order.id, sz, count]
            );
          }
        }
      }

      // Update Order Status to In_Cutting / Cutting
      db.run("UPDATE production_orders SET status = 'Cutting' WHERE id = ?", [order.id]);

      eventBus.emit(EVENTS.CUTTING_COMPLETED, {
        cutJobNo,
        productionOrderNo: order.production_order_no,
        totalPcsCut,
        variancePct
      });

      db.audit(
        userId,
        cutterId || 'usr-santosh',
        'CUTTING',
        'LAY_RECORDED',
        'cutting_jobs',
        cutJobNo,
        null,
        { cutJobNo, bundleCode: bundle.bundle_code, totalPcsCut, pallaAverageKg: calculatedPallaAvgKg, variancePct },
        `Cut Job ${cutJobNo}: Lay #${layNo} (${totalPcsCut} pcs, palla avg ${calculatedPallaAvgKg} kg, variance ${variancePct}%)`
      );

      return {
        cutJobNo,
        productionOrderNo: order.production_order_no,
        bundleCode: bundle.bundle_code,
        totalPcsCut,
        pallaAverageKg: calculatedPallaAvgKg,
        actualConsumptionPerPc,
        bomTargetConsumption: bomTarget,
        variancePct,
        varianceAlert: Math.abs(variancePct) > 5.0 ? `Yield Alert: ${variancePct}% deviation from standard BOM` : null
      };
    });
  }
};

module.exports = cuttingService;
