const db = require('../db');
const { generateSequentialCode } = require('../utils');
const { eventBus, EVENTS } = require('./events.service');

const subcontractorService = {
  // Issue Statutory Delivery Challan to Subcontractor
  issueChallan({
    productionOrderNo,
    vendorId,
    processType = 'Branding',
    brandingType = 'Screen_Print',
    panelName = 'Front_Chest',
    qtySent,
    expectedEta = null,
    createdBy = 'usr-prashant',
    remarks = null,
    userId = 'system'
  }) {
    if (!productionOrderNo || !vendorId || !panelName || !qtySent) {
      throw new Error('productionOrderNo, vendorId, panelName, and qtySent are required');
    }

    const qty = parseInt(qtySent, 10);
    if (qty <= 0) throw new Error('Quantity sent must be greater than zero');

    return db.transaction(() => {
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
      if (!order) throw new Error(`Order ${productionOrderNo} not found`);

      const vendor = db.get('SELECT * FROM entities WHERE id = ?', [vendorId]);
      if (!vendor) throw new Error(`Vendor ${vendorId} not found`);

      const challanNo = generateSequentialCode('CH', 'subcontractor_challans', 'challan_no');
      const challanId = `ch-${Date.now()}`;

      db.run(`
        INSERT INTO subcontractor_challans (
          id, challan_no, production_order_no, vendor_id, process_type,
          branding_type, panel_name, qty_sent, date_sent, expected_eta, status,
          created_by, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'Dispatched', ?, ?)
      `, [
        challanId, challanNo, order.production_order_no, vendor.id, processType,
        brandingType, panelName, qty, expectedEta, createdBy || userId, remarks
      ]);

      return {
        challanNo,
        challanId,
        productionOrderNo: order.production_order_no,
        vendorName: vendor.name,
        qtySent: qty,
        brandingType,
        panelName,
        status: 'Dispatched'
      };
    });
  },

  dispatchChallan(params) {
    return this.issueChallan(params);
  },

  // Receive Panels Back & Audit Defect Rejections
  receiveChallan({
    challanNo,
    qtyReceived,
    rejectionQty = 0,
    rejectionReason = null,
    reworkQty = 0,
    defectPhotoUrl = null,
    receivedBy = 'usr-dilip',
    userId = 'system'
  }) {
    if (!challanNo || qtyReceived === undefined || qtyReceived === null) {
      throw new Error('challanNo and qtyReceived are required');
    }

    const goodCount = parseInt(qtyReceived, 10);
    const rejectCount = parseInt(rejectionQty, 10) || 0;
    const reworkCount = parseInt(reworkQty, 10) || 0;

    return db.transaction(() => {
      const challan = db.get('SELECT * FROM subcontractor_challans WHERE challan_no = ?', [challanNo.trim()]);
      if (!challan) throw new Error(`Challan ${challanNo} not found`);

      const vendor = db.get('SELECT name FROM entities WHERE id = ?', [challan.vendor_id]);

      const newReceivedTotal = (challan.qty_received || 0) + goodCount;
      const totalRejections = (challan.rejection_qty || 0) + rejectCount;
      const totalRework = (challan.rework_qty || 0) + reworkCount;

      const isCompleted = (newReceivedTotal + totalRejections) >= challan.qty_sent;
      const status = totalRework > 0 ? 'Rework_Pending' : (isCompleted ? 'Completed' : 'Partially_Received');

      db.run(`
        UPDATE subcontractor_challans
        SET qty_received = ?, actual_received_date = CURRENT_TIMESTAMP,
            rejection_qty = ?, rejection_reason = coalesce(?, rejection_reason),
            rework_qty = ?, defect_photo_url = coalesce(?, defect_photo_url),
            status = ?, received_by = ?
        WHERE id = ?
      `, [
        newReceivedTotal, totalRejections,
        rejectionReason ? rejectionReason.trim() : null,
        totalRework, defectPhotoUrl || null,
        status, receivedBy || userId, challan.id
      ]);

      // If rejections occurred, trigger event for automated Debit Note and Remake Work Order
      if (rejectCount > 0) {
        eventBus.emit(EVENTS.SUBCONTRACTOR_REJECTION, {
          challanNo: challan.challan_no,
          vendorId: challan.vendor_id,
          vendorName: vendor?.name || 'Subcontractor',
          productionOrderNo: challan.production_order_no,
          rejectionQty: rejectCount,
          rejectionReason,
          defectPhotoUrl
        });
      }

      return {
        challanNo: challan.challan_no,
        productionOrderNo: challan.production_order_no,
        goodCountReceived: goodCount,
        newReceivedTotal,
        totalRejections,
        status
      };
    });
  },

  receivePanels(params) {
    return this.receiveChallan(params);
  },

  // List all challans
  listChallans({ orderNo = null, status = null, vendorId = null, limit = 50 } = {}) {
    let sql = `
      SELECT sc.*, e.name as vendor_name, p.product_name, p.color_name
      FROM subcontractor_challans sc
      JOIN entities e ON sc.vendor_id = e.id
      JOIN production_orders p ON sc.production_order_no = p.production_order_no
    `;
    const params = [];
    const conds = [];

    if (orderNo) {
      conds.push('sc.production_order_no = ?');
      params.push(orderNo.trim());
    }
    if (status) {
      conds.push('sc.status = ?');
      params.push(status.trim());
    }
    if (vendorId) {
      conds.push('sc.vendor_id = ?');
      params.push(vendorId.trim());
    }

    if (conds.length > 0) {
      sql += ' WHERE ' + conds.join(' AND ');
    }
    sql += ' ORDER BY sc.created_at DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 50);

    return db.query(sql, params);
  },

  getChallans(status = null) {
    return this.listChallans({ status });
  },

  // List Debit Notes
  listDebitNotes({ vendorId = null, limit = 50 } = {}) {
    let sql = 'SELECT * FROM debit_notes';
    const params = [];
    if (vendorId) {
      sql += ' WHERE vendor_id = ?';
      params.push(vendorId.trim());
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 50);

    return db.query(sql, params);
  },

  getDebitNotes() {
    return this.listDebitNotes();
  },

  // List Remake Work Orders
  listRemakeWorkOrders({ status = null, limit = 50 } = {}) {
    let sql = 'SELECT * FROM remake_work_orders';
    const params = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status.trim());
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 50);

    return db.query(sql, params);
  },

  getRemakeOrders() {
    return this.listRemakeWorkOrders();
  }
};

module.exports = subcontractorService;
