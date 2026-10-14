const db = require('../db');
const { generateSequentialCode } = require('../utils');
const { eventBus, EVENTS } = require('./events.service');

const crmService = {
  /**
   * List CRM Inquiries with optional status filter
   */
  listInquiries({ status, limit = 50 } = {}) {
    let sql = 'SELECT * FROM crm_inquiries';
    const params = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status.trim());
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 50);
    return db.query(sql, params);
  },

  /**
   * Create a new client inquiry
   */
  createInquiry({
    clientName,
    contactPerson = null,
    phone,
    email = null,
    category = 'Apparel',
    subCategory = 'Polo',
    productName,
    targetQty,
    targetBudgetPerPc = null,
    notes = null,
    userId = 'system'
  }) {
    if (!clientName || !phone || !productName || !targetQty) {
      throw new Error('clientName, phone, productName, and targetQty are required');
    }

    const inqNo = generateSequentialCode('INQ', 'crm_inquiries', 'inquiry_no');
    const inqId = `inq-${Date.now()}`;

    return db.transaction(() => {
      // Auto-create or find entity
      let client = db.get('SELECT id FROM entities WHERE name = ?', [clientName.trim()]);
      let clientId = client ? client.id : null;
      if (!clientId) {
        clientId = `ent-${Date.now()}`;
        db.run(
          "INSERT INTO entities (id, name, entity_type, contact_person, phone, email) VALUES (?, ?, 'client', ?, ?, ?)",
          [clientId, clientName.trim(), contactPerson || null, phone.trim(), email || null]
        );
      }

      db.run(`
        INSERT INTO crm_inquiries (
          id, inquiry_no, client_id, client_name, contact_person, phone, email,
          category, sub_category, product_name, target_qty, target_budget_per_pc,
          status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New', ?)
      `, [
        inqId, inqNo, clientId, clientName.trim(), contactPerson || null, phone.trim(), email || null,
        category, subCategory, productName.trim(), parseInt(targetQty, 10),
        targetBudgetPerPc ? parseFloat(targetBudgetPerPc) : null, notes || null
      ]);

      db.audit(
        userId,
        clientName,
        'CRM',
        'INQUIRY_CREATED',
        'crm_inquiries',
        inqNo,
        null,
        { inqNo, productName, targetQty },
        `New inquiry ${inqNo} from ${clientName}`
      );

      return {
        id: inqId,
        inquiryNo: inqNo,
        clientName: clientName.trim(),
        productName: productName.trim(),
        targetQty: parseInt(targetQty, 10),
        status: 'New'
      };
    });
  },

  /**
   * Update inquiry status (New -> Sample_Requested -> Quoted -> Won / Lost)
   */
  updateInquiryStatus(inquiryId, { status, notes = null, userId = 'system' }) {
    if (!inquiryId || !status) throw new Error('inquiryId and status are required');

    return db.transaction(() => {
      const inq = db.get('SELECT * FROM crm_inquiries WHERE id = ? OR inquiry_no = ?', [inquiryId, inquiryId]);
      if (!inq) throw new Error(`Inquiry '${inquiryId}' not found`);

      db.run(
        'UPDATE crm_inquiries SET status = ?, notes = coalesce(notes, \'\') || \' \' || coalesce(?, \'\') WHERE id = ?',
        [status, notes || '', inq.id]
      );

      db.audit(
        userId,
        userId,
        'CRM',
        'INQUIRY_STATUS_UPDATE',
        'crm_inquiries',
        inq.inquiry_no,
        { previousStatus: inq.status },
        { newStatus: status, notes },
        `Inquiry ${inq.inquiry_no} moved to ${status}`
      );

      return { id: inq.id, inquiryNo: inq.inquiry_no, status };
    });
  },

  /**
   * Create full Production Order with Size Matrix breakdown
   */
  createProductionOrder({
    orderType = 'Bulk', // 'Bulk', 'Sample', 'FOC', 'Development'
    clientName,
    contactPerson = null,
    phone = null,
    email = null,
    billingAddress = null,
    shippingAddress = null,
    gstin = null,
    category = 'Apparel',
    subCategory = 'Polo',
    productName,
    colorName,
    targetEtd,
    sizeMatrix, // {"S": 30, "M": 50, "L": 50, "XL": 20}
    inquiryId = null,
    clientComments = null,
    userId = 'system'
  }) {
    if (!clientName || !productName || !colorName || !sizeMatrix || !targetEtd) {
      throw new Error('clientName, productName, colorName, sizeMatrix, and targetEtd are required');
    }

    let totalQty = 0;
    const cleanSizes = {};
    for (const [s, count] of Object.entries(sizeMatrix)) {
      const parsed = parseInt(count, 10) || 0;
      if (parsed > 0) {
        cleanSizes[s] = parsed;
        totalQty += parsed;
      }
    }

    if (totalQty <= 0) {
      throw new Error('Total order quantity from size matrix must be greater than zero');
    }

    return db.transaction(() => {
      // 1. Ensure Client Entity exists
      let client = db.get('SELECT id FROM entities WHERE name = ?', [clientName.trim()]);
      let clientId;
      if (client) {
        clientId = client.id;
        db.run(
          'UPDATE entities SET contact_person = coalesce(?, contact_person), phone = coalesce(?, phone), email = coalesce(?, email), gstin = coalesce(?, gstin), address = coalesce(?, address) WHERE id = ?',
          [contactPerson || null, phone || null, email || null, gstin || null, billingAddress || shippingAddress || null, clientId]
        );
      } else {
        clientId = `ent-${Date.now()}`;
        db.run(
          "INSERT INTO entities (id, name, entity_type, contact_person, phone, email, gstin, address) VALUES (?, ?, 'client', ?, ?, ?, ?, ?)",
          [clientId, clientName.trim(), contactPerson || null, phone || null, email || null, gstin || null, billingAddress || null]
        );
      }

      // 2. Generate Sequential Order Code: FPCC-PO-YYMMDD-NN
      const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
      const pattern = `FPCC-PO-${dateStr}-%`;
      const latestOrder = db.get(
        'SELECT production_order_no FROM production_orders WHERE production_order_no LIKE ? ORDER BY production_order_no DESC LIMIT 1',
        [pattern]
      );
      let orderSeq = 1;
      if (latestOrder && latestOrder.production_order_no) {
        const parts = latestOrder.production_order_no.split('-');
        if (parts.length >= 4) {
          orderSeq = parseInt(parts[3], 10) + 1;
        }
      }
      const productionOrderNo = `FPCC-PO-${dateStr}-${String(orderSeq).padStart(2, '0')}`;
      const salesOrderNo = `SO-${dateStr}-${String(orderSeq).padStart(2, '0')}`;
      const orderId = `ord-${Date.now()}`;

      // 3. Insert Production Order
      db.run(`
        INSERT INTO production_orders (
          id, production_order_no, sales_order_no, order_type, client_id, client_name,
          product_name, color_name, total_qty, target_etd, status, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Planning', ?)
      `, [
        orderId, productionOrderNo, salesOrderNo, orderType,
        clientId, clientName.trim(), productName.trim(), colorName.trim(),
        totalQty, targetEtd, clientComments || `Category: ${category}/${subCategory}`
      ]);

      // 4. Insert Order Size Matrix
      for (const [sz, qty] of Object.entries(cleanSizes)) {
        const matrixId = `osm-${Date.now()}-${sz}`;
        db.run(
          'INSERT INTO order_size_matrix (id, production_order_id, size_label, order_qty, cut_qty, finished_qty, packed_qty) VALUES (?, ?, ?, ?, 0, 0, 0)',
          [matrixId, orderId, sz, qty]
        );
      }

      // 5. If inquiry provided, mark Converted_To_Order
      if (inquiryId) {
        db.run("UPDATE crm_inquiries SET status = 'Converted_To_Order' WHERE id = ? OR inquiry_no = ?", [inquiryId, inquiryId]);
      }

      // 6. Trigger eventBus & audit
      eventBus.emit(EVENTS.ORDER_CREATED, {
        productionOrderNo,
        productName: productName.trim(),
        totalQty,
        clientName: clientName.trim(),
        userId
      });

      return {
        orderId,
        productionOrderNo,
        salesOrderNo,
        clientName: clientName.trim(),
        productName: productName.trim(),
        colorName: colorName.trim(),
        totalQty,
        sizeMatrix: cleanSizes,
        targetEtd,
        status: 'Planning',
        whatsappNotificationSent: true
      };
    });
  },

  /**
   * Get complete details of a production order including all operational sub-records
   */
  getOrderDetails(productionOrderNo) {
    if (!productionOrderNo) throw new Error('productionOrderNo is required');

    const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
    if (!order) throw new Error(`Production Order '${productionOrderNo}' not found`);

    const sizeMatrix = db.query(
      'SELECT size_label, order_qty, cut_qty, finished_qty, packed_qty FROM order_size_matrix WHERE production_order_id = ? ORDER BY id ASC',
      [order.id]
    );

    const cuttingJobs = db.query(
      'SELECT cut_job_no, bundle_code, calculated_palla_avg_kg, total_pcs_cut, actual_consumption_per_pc, variance_pct, created_at FROM cutting_jobs WHERE production_order_no = ? ORDER BY created_at DESC',
      [order.production_order_no]
    );

    const transits = db.query(
      'SELECT transit_pass_no, source_station, dest_station, item_type, dispatched_qty, received_qty, transit_status, variance_qty FROM material_transits WHERE production_order_no = ? ORDER BY created_at DESC',
      [order.production_order_no]
    );

    const challans = db.query(
      'SELECT challan_no, process_type, branding_type, qty_sent, qty_received, rejection_qty, status FROM subcontractor_challans WHERE production_order_no = ? ORDER BY created_at DESC',
      [order.production_order_no]
    );

    const cartons = db.query(
      'SELECT carton_no, box_type, gross_weight_kg, total_pcs, status FROM carton_packings WHERE production_order_no = ? ORDER BY created_at DESC',
      [order.production_order_no]
    );

    const bomAllocations = db.query(
      'SELECT item_type, item_name, color_name, uom, required_qty, allocated_qty, shortfall_qty, status, purchase_order_no FROM order_bom_allocations WHERE production_order_no = ?',
      [order.production_order_no]
    );

    const invoices = db.query(
      'SELECT invoice_no, invoice_date, total_amount, amount_paid, balance_due, payment_status FROM invoices WHERE production_order_no = ?',
      [order.production_order_no]
    );

    return {
      order,
      sizeMatrix,
      cuttingJobs,
      transits,
      challans,
      cartons,
      bomAllocations,
      invoices
    };
  }
};

module.exports = crmService;
