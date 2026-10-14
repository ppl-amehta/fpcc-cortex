const db = require('../db');
const { generateSequentialCode, round } = require('../utils');
const { eventBus, EVENTS } = require('./events.service');

const packingService = {
  /**
   * Pack garments into a Master Carton with strict size matrix reconciliation
   */
  packCarton({
    productionOrderNo,
    boxType = '7-Ply Heavy Master Box',
    grossWeightKg = null,
    sizeBreakdown, // e.g. {"S": 10, "M": 20, "L": 20}
    packedBy = 'usr-dilip',
    destinationAddress = null,
    remarks = null,
    userId = 'system'
  }) {
    if (!productionOrderNo || !sizeBreakdown || typeof sizeBreakdown !== 'object') {
      throw new Error('productionOrderNo and sizeBreakdown object are required');
    }

    let totalPcs = 0;
    const cleanSizes = {};
    for (const [size, count] of Object.entries(sizeBreakdown)) {
      const parsed = parseInt(count, 10) || 0;
      if (parsed < 0) {
        throw new Error(`Invalid pack count for size ${size}: cannot be negative`);
      }
      cleanSizes[size] = parsed;
      totalPcs += parsed;
    }

    if (totalPcs <= 0) {
      throw new Error('Total packed pieces must be greater than zero');
    }

    return db.transaction(() => {
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
      if (!order) {
        throw new Error(`Production Order '${productionOrderNo}' not found`);
      }

      // Check against order size matrix for over-pack prevention
      for (const [size, count] of Object.entries(cleanSizes)) {
        if (count > 0) {
          const matrixEntry = db.get(
            'SELECT * FROM order_size_matrix WHERE production_order_id = ? AND size_label = ?',
            [order.id, size]
          );
          if (matrixEntry) {
            const cutLimit = matrixEntry.cut_qty || matrixEntry.order_qty;
            const newTotalPacked = (matrixEntry.packed_qty || 0) + count;
            // Allow small buffer (e.g. 5% overrun) but guard against massive erroneous packing
            if (cutLimit > 0 && newTotalPacked > Math.ceil(cutLimit * 1.1)) {
              throw new Error(`Over-pack prevented for size ${size}: Cut limit is ${cutLimit}, already packed ${matrixEntry.packed_qty || 0}, trying to pack ${count} more (Total: ${newTotalPacked})`);
            }
          }
        }
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
          db.run(
            'UPDATE order_size_matrix SET packed_qty = packed_qty + ? WHERE production_order_id = ? AND size_label = ?',
            [count, order.id, s]
          );
        }
      }

      // Check if total packed pieces across order meets or exceeds order target
      const totalPackedRow = db.get(
        'SELECT coalesce(sum(total_pcs), 0) as total FROM carton_packings WHERE production_order_no = ?',
        [order.production_order_no]
      );
      const totalPackedOrder = totalPackedRow ? totalPackedRow.total : 0;
      if (totalPackedOrder >= order.total_qty && order.status !== 'Completed') {
        db.run("UPDATE production_orders SET status = 'Packed' WHERE id = ?", [order.id]);
      }

      db.audit(
        userId,
        packedBy,
        'PACKING',
        'CARTON_SEALED',
        'carton_packings',
        cartonNo,
        null,
        { cartonNo, totalPcs, grossWeightKg },
        `Carton ${cartonNo} sealed with ${totalPcs} pieces (${boxType})`
      );

      return {
        cartonId,
        cartonNo,
        productionOrderNo: order.production_order_no,
        totalPcs,
        grossWeightKg: grossWeightKg ? parseFloat(grossWeightKg) : null,
        sizeBreakdown: cleanSizes,
        status: 'Sealed'
      };
    });
  },

  /**
   * Get carton listing with order filtering
   */
  getCartons({ orderNo, status, limit = 50 } = {}) {
    let sql = `
      SELECT c.*, u.user_name as packed_by_name, p.client_name, p.product_name, p.color_name as order_color
      FROM carton_packings c
      JOIN users u ON c.packed_by = u.id
      JOIN production_orders p ON c.production_order_no = p.production_order_no
    `;
    const params = [];
    const conditions = [];

    if (orderNo) {
      conditions.push('c.production_order_no = ?');
      params.push(orderNo.trim());
    }
    if (status) {
      conditions.push('c.status = ?');
      params.push(status.trim());
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY c.created_at DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 50);

    return db.query(sql, params);
  },

  /**
   * Generate complete packing manifest for an order
   */
  getPackingManifest(productionOrderNo) {
    if (!productionOrderNo) throw new Error('productionOrderNo is required');

    const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
    if (!order) throw new Error(`Production Order '${productionOrderNo}' not found`);

    const cartons = db.query(
      'SELECT * FROM carton_packings WHERE production_order_no = ? ORDER BY carton_no ASC',
      [order.production_order_no]
    );

    let totalBoxes = cartons.length;
    let totalPieces = 0;
    let totalGrossWeightKg = 0;
    const aggregatedSizes = {};

    for (const c of cartons) {
      totalPieces += c.total_pcs || 0;
      totalGrossWeightKg += c.gross_weight_kg || 0;
      try {
        const breakdown = JSON.parse(c.size_breakdown_json || '{}');
        for (const [s, count] of Object.entries(breakdown)) {
          aggregatedSizes[s] = (aggregatedSizes[s] || 0) + (parseInt(count, 10) || 0);
        }
      } catch (e) {
        // ignore malformed json
      }
    }

    return {
      productionOrderNo: order.production_order_no,
      clientName: order.client_name,
      productName: order.product_name,
      orderTargetQty: order.total_qty,
      totalBoxes,
      totalPieces,
      totalGrossWeightKg: round(totalGrossWeightKg, 2),
      aggregatedSizes,
      cartons
    };
  }
};

module.exports = packingService;
