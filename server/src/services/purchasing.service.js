const db = require('../db');
const { generateSequentialCode, round } = require('../utils');
const { eventBus, EVENTS } = require('./events.service');

const purchasingService = {
  /**
   * List all Purchase Orders with optional status or vendor filter
   */
  listPurchaseOrders({ status = null, vendorId = null, limit = 50 } = {}) {
    let sql = 'SELECT * FROM purchase_orders';
    const params = [];
    const conds = [];
    if (status) {
      conds.push('status = ?');
      params.push(status);
    }
    if (vendorId) {
      conds.push('vendor_id = ?');
      params.push(vendorId);
    }
    if (conds.length > 0) {
      sql += ' WHERE ' + conds.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 50);

    const orders = db.query(sql, params);
    return orders.map(po => {
      const items = db.query('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [po.id]);
      return { ...po, items };
    });
  },

  getAllPOs(status = null) {
    return this.listPurchaseOrders({ status });
  },

  /**
   * Get specific PO by ID or PO Number
   */
  getPurchaseOrder(idOrNo) {
    const po = db.get('SELECT * FROM purchase_orders WHERE id = ? OR purchase_order_no = ?', [idOrNo.trim(), idOrNo.trim()]);
    if (!po) return null;
    const items = db.query('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [po.id]);
    return { ...po, items };
  },

  getPOById(idOrNo) {
    return this.getPurchaseOrder(idOrNo);
  },

  /**
   * Create Purchase Order with Line Items
   */
  createPurchaseOrder({
    vendorId,
    orderType = 'Fabric',
    relatedProductionOrderNo = null,
    expectedDeliveryDate = null,
    paymentTerms = '30_days_credit',
    deliveryTerms = 'door_delivery',
    notes = null,
    createdBy = null,
    userId = 'system',
    items = []
  }) {
    if (!vendorId || !items || items.length === 0) {
      throw new Error('vendorId and at least one item line are required');
    }

    return db.transaction(() => {
      const vendor = db.get('SELECT * FROM entities WHERE id = ?', [vendorId]);
      if (!vendor) {
        throw new Error(`Vendor ${vendorId} not found`);
      }

      const poNo = generateSequentialCode('PO', 'purchase_orders', 'purchase_order_no');
      const poId = `po-${Date.now()}`;
      const poDate = new Date().toISOString().slice(0, 10);

      // Calculate totals
      let subtotal = 0;
      const cleanItems = items.map(it => {
        const qty = parseFloat(it.orderedQty) || 0;
        const rate = parseFloat(it.unitPrice) || 0;
        const lineTotal = round(qty * rate, 2);
        subtotal += lineTotal;
        return {
          id: `poi-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          itemType: it.itemType || 'Fabric',
          itemName: (it.itemName || 'Material').trim(),
          colorName: it.colorName ? it.colorName.trim() : null,
          specifications: it.specifications || null,
          orderedQty: qty,
          uom: it.uom || 'kg',
          unitPrice: rate,
          lineTotal,
          receivedQty: 0.0,
          balanceQty: qty
        };
      });

      const taxRate = orderType === 'Fabric' ? 5.0 : 18.0;
      const taxAmount = round(subtotal * (taxRate / 100), 2);
      const totalAmount = round(subtotal + taxAmount, 2);

      // Insert PO header
      db.run(`
        INSERT INTO purchase_orders (
          id, purchase_order_no, vendor_id, vendor_name, vendor_contact_person,
          vendor_phone, vendor_email, order_type, related_production_order_no,
          po_date, expected_delivery_date, subtotal_amount, tax_amount, total_amount,
          payment_terms, delivery_terms, status, notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?)
      `, [
        poId, poNo, vendor.id, vendor.name, vendor.contact_person,
        vendor.phone, vendor.email, orderType, relatedProductionOrderNo,
        poDate, expectedDeliveryDate, subtotal, taxAmount, totalAmount,
        paymentTerms, deliveryTerms, notes, createdBy || userId
      ]);

      // Insert PO items
      for (const item of cleanItems) {
        db.run(`
          INSERT INTO purchase_order_items (
            id, purchase_order_id, item_type, item_name, color_name,
            specifications, ordered_qty, uom, unit_price, line_total,
            received_qty, balance_qty, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')
        `, [
          item.id, poId, item.itemType, item.itemName, item.colorName,
          item.specifications, item.orderedQty, item.uom, item.unitPrice,
          item.lineTotal, item.receivedQty, item.balanceQty
        ]);
      }

      // If linked to production order, update BOM allocations
      if (relatedProductionOrderNo) {
        db.run(`
          UPDATE order_bom_allocations
          SET status = 'PO_Drafted', purchase_order_no = ?
          WHERE production_order_no = ? AND shortfall_qty > 0
        `, [poNo, relatedProductionOrderNo]);
      }

      db.audit(
        userId,
        createdBy || userId,
        'PURCHASING',
        'PO_CREATED',
        'purchase_orders',
        poNo,
        null,
        { poNo, vendorName: vendor.name, totalAmount, itemsCount: cleanItems.length },
        `PO ${poNo} created for ${vendor.name} (₹${totalAmount})`
      );

      return {
        poId,
        purchaseOrderNo: poNo,
        vendorName: vendor.name,
        totalAmount,
        status: 'Draft',
        itemsCount: cleanItems.length
      };
    });
  },

  createPO(params) {
    return this.createPurchaseOrder(params);
  },

  /**
   * Executive authorization of Purchase Order
   */
  approvePurchaseOrder(poIdOrNo, { userId = 'system' } = {}) {
    return db.transaction(() => {
      const po = db.get('SELECT * FROM purchase_orders WHERE id = ? OR purchase_order_no = ?', [poIdOrNo.trim(), poIdOrNo.trim()]);
      if (!po) throw new Error(`Purchase order '${poIdOrNo}' not found`);

      db.run("UPDATE purchase_orders SET status = 'Acknowledged' WHERE id = ?", [po.id]);

      db.audit(
        userId,
        userId,
        'PURCHASING',
        'PO_APPROVED',
        'purchase_orders',
        po.purchase_order_no,
        { status: po.status },
        { status: 'Acknowledged' },
        `Purchase Order ${po.purchase_order_no} authorized and acknowledged for procurement`
      );

      return {
        purchaseOrderNo: po.purchase_order_no,
        status: 'Acknowledged'
      };
    });
  },

  /**
   * Reconcile received goods against Purchase Order
   */
  receiveGoodsAgainstPO(poIdOrNo, { itemsReceived = [], invoiceNo = null, remarks = null, userId = 'system' } = {}) {
    return db.transaction(() => {
      const po = db.get('SELECT * FROM purchase_orders WHERE id = ? OR purchase_order_no = ?', [poIdOrNo.trim(), poIdOrNo.trim()]);
      if (!po) throw new Error(`Purchase order '${poIdOrNo}' not found`);

      const items = db.query('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [po.id]);
      let allFulfilled = true;

      for (const item of items) {
        const matchingRec = itemsReceived.find(r => r.itemId === item.id || r.itemName === item.item_name);
        const recQty = matchingRec ? parseFloat(matchingRec.receivedQty) : item.ordered_qty;

        const newReceived = round((item.received_qty || 0) + recQty, 3);
        const newBalance = round(Math.max(0, item.ordered_qty - newReceived), 3);
        const itemStatus = newBalance <= 0 ? 'Received' : 'Partially_Received';

        if (newBalance > 0) allFulfilled = false;

        db.run(`
          UPDATE purchase_order_items
          SET received_qty = ?, balance_qty = ?, status = ?
          WHERE id = ?
        `, [newReceived, newBalance, itemStatus, item.id]);
      }

      const poStatus = allFulfilled ? 'Completed' : 'Partially_Received';
      db.run('UPDATE purchase_orders SET status = ? WHERE id = ?', [poStatus, po.id]);

      db.audit(
        userId,
        userId,
        'PURCHASING',
        'PO_GOODS_RECEIVED',
        'purchase_orders',
        po.purchase_order_no,
        { previousStatus: po.status },
        { status: poStatus, invoiceNo },
        `Goods received against PO ${po.purchase_order_no} (Inv: ${invoiceNo || 'N/A'})`
      );

      return {
        purchaseOrderNo: po.purchase_order_no,
        status: poStatus,
        allFulfilled
      };
    });
  },

  /**
   * Dispatch Purchase Order to Vendor via WhatsApp
   */
  dispatchPOViaWhatsApp(poIdOrNo, { userId = 'system' } = {}) {
    return db.transaction(() => {
      const po = db.get('SELECT * FROM purchase_orders WHERE id = ? OR purchase_order_no = ?', [poIdOrNo.trim(), poIdOrNo.trim()]);
      if (!po) throw new Error('Purchase order not found');

      db.run("UPDATE purchase_orders SET status = 'Sent_To_Vendor', whatsapp_dispatch_status = 'SENT' WHERE id = ?", [po.id]);

      const cleanPhone = po.vendor_phone ? po.vendor_phone.replace(/[^0-9]/g, '') : '919820011223';
      const items = db.query('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [po.id]);
      const itemList = items.map(it => `• ${it.item_name}: ${it.ordered_qty} ${it.uom} @ ₹${it.unit_price}`).join('\n');

      const messageBody = `📦 *FPCC TEXTILES PURCHASE ORDER: ${po.purchase_order_no}*\n` +
        `Dear ${po.vendor_name},\n` +
        `Please accept PO #${po.purchase_order_no} for the following procurement items:\n` +
        `${itemList}\n\n` +
        `• Subtotal: ₹${po.subtotal_amount}\n` +
        `• GST (5%/18%): ₹${po.tax_amount}\n` +
        `• *Total PO Value: ₹${po.total_amount}*\n` +
        `• Payment Terms: ${po.payment_terms}\n` +
        `Please confirm receipt and dispatch schedule. Thank you!`;

      db.run(`
        INSERT INTO whatsapp_logs (
          id, direction, phone_number, recipient_name, message_type,
          template_name, message_body, related_entity_type, related_entity_id, status
        ) VALUES (?, 'OUTBOUND', ?, ?, 'PO_DISPATCH', 'vendor_po_v1', ?, 'PO', ?, 'DELIVERED')
      `, [`wa-${Date.now()}`, cleanPhone, po.vendor_name, messageBody, po.purchase_order_no]);

      db.audit(
        userId,
        userId,
        'PURCHASING',
        'PO_WHATSAPP_DISPATCH',
        'purchase_orders',
        po.purchase_order_no,
        null,
        { recipient: po.vendor_name, phone: cleanPhone },
        `PO ${po.purchase_order_no} dispatched via WhatsApp to ${po.vendor_name}`
      );

      return {
        purchaseOrderNo: po.purchase_order_no,
        status: 'Sent_To_Vendor',
        whatsappSent: true
      };
    });
  },

  dispatchPO(poIdOrNo) {
    return this.dispatchPOViaWhatsApp(poIdOrNo);
  }
};

module.exports = purchasingService;
