const db = require('../db');
const { generateSequentialCode, round } = require('../utils');
const { eventBus, EVENTS } = require('./events.service');

const floorService = {
  /**
   * Log daily operation telemetry (Stitching, T/C, Kaaj, Button, Ironing, QC)
   */
  logTelemetry({
    productionOrderNo,
    processName, // 'Stitching', 'Thread_Cutting', 'Kaaj', 'Button', 'Eyelet', 'Bartack', 'Heatseal', 'Ironing', 'QC_Inspection'
    operatorId = 'usr-dilip',
    stationCode = 'LINE-1',
    completedQty,
    rejectedQty = 0,
    reworkQty = 0,
    defectCategory = null,
    sizeBreakdown = null,
    remarks = null,
    userId = 'system'
  }) {
    if (!productionOrderNo || !processName || completedQty === undefined || completedQty === null) {
      throw new Error('productionOrderNo, processName, and completedQty are required');
    }

    const completed = parseInt(completedQty, 10);
    const rejected = parseInt(rejectedQty, 10) || 0;
    const rework = parseInt(reworkQty, 10) || 0;

    if (completed < 0 || rejected < 0 || rework < 0) {
      throw new Error('Quantities cannot be negative');
    }

    return db.transaction(() => {
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
      if (!order) {
        throw new Error(`Production Order '${productionOrderNo}' not found`);
      }

      const logId = `proc-${Date.now()}`;
      const logDate = new Date().toISOString().slice(0, 10);

      db.run(`
        INSERT INTO floor_process_logs (
          id, production_order_no, process_name, operator_id, station_code,
          log_date, completed_qty, rejected_qty, rework_qty, defect_category,
          size_breakdown_json, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        logId, order.production_order_no, processName.trim(), operatorId,
        stationCode || 'DEFAULT', logDate, completed, rejected, rework,
        defectCategory || null, sizeBreakdown ? JSON.stringify(sizeBreakdown) : null,
        remarks || null
      ]);

      // If Stitching or Finishing, update order size matrix finished counts
      if ((processName === 'Stitching' || processName === 'QC_Inspection') && sizeBreakdown) {
        for (const [size, count] of Object.entries(sizeBreakdown)) {
          const parsed = parseInt(count, 10) || 0;
          if (parsed > 0) {
            const matrixEntry = db.get(
              'SELECT id FROM order_size_matrix WHERE production_order_id = ? AND size_label = ?',
              [order.id, size]
            );
            if (matrixEntry) {
              db.run('UPDATE order_size_matrix SET finished_qty = finished_qty + ? WHERE id = ?', [parsed, matrixEntry.id]);
            }
          }
        }
      }

      // If rejections occur, log to audit trail
      if (rejected > 0) {
        db.audit(
          userId,
          operatorId,
          'FLOOR_QC',
          'DEFECT_LOGGED',
          'floor_process_logs',
          logId,
          null,
          { processName, rejectedQty: rejected, defectCategory },
          `QC Defect: ${rejected} pcs rejected in ${processName} (${defectCategory || 'Unspecified'})`
        );
      }

      return {
        logId,
        productionOrderNo: order.production_order_no,
        processName,
        completedQty: completed,
        rejectedQty: rejected,
        reworkQty: rework,
        defectCategory
      };
    });
  },

  /**
   * Get process logs with optional order and process filtering
   */
  getProcessLogs({ orderNo, processName, limit = 50 }) {
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
    sql += ' ORDER BY f.created_at DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 50);

    return db.query(sql, params);
  },

  /**
   * Get Defect Pareto Analysis across stations
   */
  getDefectPareto({ orderNo } = {}) {
    let sql = `
      SELECT defect_category, process_name, sum(rejected_qty) as total_rejected, sum(rework_qty) as total_rework
      FROM floor_process_logs
      WHERE (rejected_qty > 0 OR rework_qty > 0)
    `;
    const params = [];
    if (orderNo) {
      sql += ' AND production_order_no = ?';
      params.push(orderNo.trim());
    }
    sql += ' GROUP BY defect_category, process_name ORDER BY total_rejected DESC';

    const records = db.query(sql, params);
    const grandTotal = records.reduce((acc, r) => acc + (r.total_rejected || 0), 0);

    let cumulative = 0;
    return records.map(r => {
      cumulative += r.total_rejected || 0;
      return {
        ...r,
        cumulativePercentage: grandTotal > 0 ? round((cumulative / grandTotal) * 100, 1) : 0
      };
    });
  },

  /**
   * Get operator efficiency & output analytics
   */
  getOperatorStats() {
    return db.query(`
      SELECT u.id as operator_id, u.user_name, f.process_name,
             sum(f.completed_qty) as total_completed,
             sum(f.rejected_qty) as total_rejected,
             sum(f.rework_qty) as total_rework,
             count(f.id) as log_count
      FROM floor_process_logs f
      JOIN users u ON f.operator_id = u.id
      GROUP BY u.id, u.user_name, f.process_name
      ORDER BY total_completed DESC
    `);
  }
};

module.exports = floorService;
