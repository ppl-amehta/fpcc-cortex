const db = require('../db');
const { generateSequentialCode } = require('../utils');
const { eventBus, EVENTS } = require('./events.service');

const runnerService = {
  // Dispatch Material Movement Pass
  dispatchTransit({
    productionOrderNo,
    sourceStation,
    destStation,
    runnerId = 'usr-ramesh',
    itemType = 'Cut_Panels', // 'Cut_Panels', 'Semi_Stitched', 'Finished_Garments', 'Fabric_Rolls', 'Trims_Accessories', 'Sealed_Cartons'
    itemRef = null,
    dispatchedQty,
    dispatchedBy = 'usr-santosh',
    notes = null,
    userId = 'system'
  }) {
    if (!productionOrderNo || !sourceStation || !destStation || !dispatchedQty) {
      throw new Error('productionOrderNo, sourceStation, destStation, and dispatchedQty are required');
    }

    const qty = parseInt(dispatchedQty, 10);
    if (qty <= 0) throw new Error('Dispatched quantity must be greater than zero');

    return db.transaction(() => {
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
      if (!order) throw new Error(`Order ${productionOrderNo} not found`);

      const runner = db.get('SELECT * FROM users WHERE id = ?', [runnerId]);
      if (!runner) throw new Error(`Runner ${runnerId} not found`);

      const passNo = generateSequentialCode('TRN', 'material_transits', 'transit_pass_no');
      const transitId = `trn-${Date.now()}`;

      db.run(`
        INSERT INTO material_transits (
          id, transit_pass_no, production_order_no, source_station, dest_station,
          runner_id, item_type, item_ref, dispatched_qty, dispatched_by,
          transit_status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISPATCHED', ?)
      `, [
        transitId, passNo, order.production_order_no, sourceStation.trim(), destStation.trim(),
        runner.id, itemType, itemRef, qty, dispatchedBy || userId, notes
      ]);

      return {
        transitPassNo: passNo,
        transitId,
        productionOrderNo: order.production_order_no,
        sourceStation,
        destStation,
        runnerName: runner.user_name,
        dispatchedQty: qty,
        status: 'DISPATCHED'
      };
    });
  },

  dispatch(params) {
    return this.dispatchTransit(params);
  },

  // Runner Pickup (Starts in-transit tracking clock)
  pickupTransit(passNoOrId, runnerId = null) {
    const idOrNo = (typeof passNoOrId === 'object') ? passNoOrId.transitPassNo : passNoOrId;
    const rId = (typeof passNoOrId === 'object' && passNoOrId.runnerId) ? passNoOrId.runnerId : runnerId;

    return db.transaction(() => {
      const transit = db.get('SELECT * FROM material_transits WHERE transit_pass_no = ? OR id = ?', [idOrNo, idOrNo]);
      if (!transit) throw new Error(`Transit pass ${idOrNo} not found`);
      if (transit.transit_status !== 'DISPATCHED') {
        throw new Error(`Transit pass is already in '${transit.transit_status}' state`);
      }

      db.run(`
        UPDATE material_transits
        SET transit_status = 'IN_TRANSIT', picked_up_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [transit.id]);

      eventBus.emit(EVENTS.RUNNER_PICKUP, {
        transitPassNo: transit.transit_pass_no,
        productionOrderNo: transit.production_order_no,
        sourceStation: transit.source_station,
        destStation: transit.dest_station
      });

      return {
        transitPassNo: transit.transit_pass_no,
        status: 'IN_TRANSIT',
        pickedUpAt: new Date().toISOString()
      };
    });
  },

  pickup(params) {
    return this.pickupTransit(params);
  },

  // Destination Handover & Exact Count Verification
  receiveTransit(passNoOrId, receivedQty, receivedBy = null, discrepancyReason = null) {
    let idOrNo = passNoOrId;
    let count = receivedQty;
    let recBy = receivedBy;
    let discReason = discrepancyReason;

    if (typeof passNoOrId === 'object') {
      idOrNo = passNoOrId.transitPassNo;
      count = passNoOrId.receivedQty;
      recBy = passNoOrId.receivedBy;
      discReason = passNoOrId.discrepancyReason;
    }

    if (count === null || count === undefined) {
      throw new Error('receivedQty is required for handover verification');
    }

    const actualCount = parseInt(count, 10);
    if (isNaN(actualCount) || actualCount < 0) {
      throw new Error('Received quantity must be a non-negative integer');
    }

    return db.transaction(() => {
      const transit = db.get('SELECT * FROM material_transits WHERE transit_pass_no = ? OR id = ?', [idOrNo, idOrNo]);
      if (!transit) throw new Error(`Transit pass ${idOrNo} not found`);

      const variance = transit.dispatched_qty - actualCount;
      const hasDiscrepancy = variance !== 0;

      if (hasDiscrepancy && !discReason) {
        throw new Error(`Handover count mismatch (${actualCount} received vs ${transit.dispatched_qty} sent). Discrepancy reason is strictly mandatory.`);
      }

      const status = hasDiscrepancy ? 'DISCREPANCY_FLAGGED' : 'DELIVERED_VERIFIED';

      db.run(`
        UPDATE material_transits
        SET received_qty = ?, received_by = ?, received_at = CURRENT_TIMESTAMP,
            transit_status = ?, variance_qty = ?, discrepancy_reason = ?
        WHERE id = ?
      `, [
        actualCount, recBy || 'usr-suresh', status, variance,
        hasDiscrepancy ? discReason.trim() : null, transit.id
      ]);

      const runner = db.get('SELECT user_name FROM users WHERE id = ?', [transit.runner_id]);

      if (hasDiscrepancy) {
        eventBus.emit(EVENTS.RUNNER_DISCREPANCY, {
          transitPassNo: transit.transit_pass_no,
          productionOrderNo: transit.production_order_no,
          sourceStation: transit.source_station,
          destStation: transit.dest_station,
          runnerName: runner?.user_name || 'Assigned Runner',
          dispatchedQty: transit.dispatched_qty,
          receivedQty: actualCount,
          variance,
          reason: discReason
        });
      }

      return {
        transitPassNo: transit.transit_pass_no,
        sourceStation: transit.source_station,
        destStation: transit.dest_station,
        status,
        dispatchedQty: transit.dispatched_qty,
        receivedQty: actualCount,
        variance,
        hasDiscrepancy,
        discrepancyAlert: hasDiscrepancy ? `ALERT: Discrepancy of ${Math.abs(variance)} pcs logged for runner handover!` : null
      };
    });
  },

  receiveHandover(params) {
    return this.receiveTransit(params);
  },

  // List all transits with filtering
  listTransits({ status = null, orderNo = null, runnerId = null, limit = 50 } = {}) {
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
    if (runnerId) {
      conditions.push('t.runner_id = ?');
      params.push(runnerId.trim());
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY t.created_at DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 50);

    return db.query(sql, params);
  },

  // Get active transits
  getActiveTransits() {
    return this.listTransits({ status: 'IN_TRANSIT' });
  },

  // Get flagged discrepancies
  getFlaggedDiscrepancies() {
    return this.listTransits({ status: 'DISCREPANCY_FLAGGED' });
  }
};

module.exports = runnerService;
