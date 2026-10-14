const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper to generate sequential numbers
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

// 1. GET all CRM inquiries
router.get('/inquiries', (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM crm_inquiries';
    const params = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status.trim());
    }
    sql += ' ORDER BY created_at DESC';
    const inquiries = db.query(sql, params);
    res.json({ success: true, count: inquiries.length, data: inquiries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. POST create new inquiry
router.post('/inquiries', (req, res) => {
  try {
    const {
      clientName,
      contactPerson,
      phone,
      email,
      category = 'Apparel',
      subCategory = 'Polo',
      productName,
      targetQty,
      targetBudgetPerPc,
      notes
    } = req.body;

    if (!clientName || !phone || !productName || !targetQty) {
      return res.status(400).json({ success: false, error: 'Missing required inquiry fields (clientName, phone, productName, targetQty)' });
    }

    const inqNo = generateSequentialCode('INQ', 'crm_inquiries', 'inquiry_no');
    const inqId = `inq-${Date.now()}`;

    // Auto-create or find entity
    let client = db.get('SELECT id FROM entities WHERE name = ?', [clientName.trim()]);
    let clientId = client ? client.id : null;
    if (!clientId) {
      clientId = `ent-${Date.now()}`;
      db.run("INSERT INTO entities (id, name, entity_type, contact_person, phone, email) VALUES (?, ?, 'client', ?, ?, ?)",
        [clientId, clientName.trim(), contactPerson || null, phone.trim(), email || null]);
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

    res.json({ success: true, data: { inquiryNo: inqNo, id: inqId, clientName } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 3. POST Native Order Taking (Replaces Zoho)
// Creates full Production Order with Size Matrix, Client Details, and triggers WhatsApp Confirmation
router.post('/orders/create', (req, res) => {
  try {
    const {
      orderType = 'Bulk', // 'Bulk', 'Sample', 'FOC', 'Development'
      clientName,
      contactPerson,
      phone,
      email,
      billingAddress,
      shippingAddress,
      gstin,
      category = 'Apparel',
      subCategory = 'Polo',
      productName,
      colorName,
      unitPrice,
      taxRate = 5.0,
      taxBilling = 'extra',
      freightMode = 'surface',
      freightCostTerms = 'paid_by_client',
      targetEtd,
      sizeMatrix, // e.g. {"S": 30, "M": 50, "L": 50, "XL": 20}
      brandingSpecs, // string or json
      clientComments
    } = req.body;

    if (!clientName || !productName || !colorName || !sizeMatrix || !targetEtd) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required order fields (clientName, productName, colorName, sizeMatrix, targetEtd)' 
      });
    }

    // Calculate total quantity from size matrix
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
      return res.status(400).json({ success: false, error: 'Total order quantity from size breakdown must be greater than zero.' });
    }

    const result = db.transaction(() => {
      // 1. Ensure Client Entity exists
      let client = db.get('SELECT id FROM entities WHERE name = ?', [clientName.trim()]);
      let clientId;
      if (client) {
        clientId = client.id;
        // update contact info if provided
        db.run('UPDATE entities SET contact_person = coalesce(?, contact_person), phone = coalesce(?, phone), email = coalesce(?, email), gstin = coalesce(?, gstin), address = coalesce(?, address) WHERE id = ?',
          [contactPerson || null, phone || null, email || null, gstin || null, billingAddress || shippingAddress || null, clientId]);
      } else {
        clientId = `ent-${Date.now()}`;
        db.run("INSERT INTO entities (id, name, entity_type, contact_person, phone, email, gstin, address) VALUES (?, ?, 'client', ?, ?, ?, ?, ?)",
          [clientId, clientName.trim(), contactPerson || null, phone || null, email || null, gstin || null, billingAddress || null]);
      }

      // 2. Generate Production Order No: FPCC-PO-YYMMDD-NN
      const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
      const pattern = `FPCC-PO-${dateStr}-%`;
      const latestOrder = db.get('SELECT production_order_no FROM production_orders WHERE production_order_no LIKE ? ORDER BY production_order_no DESC LIMIT 1', [pattern]);
      let orderSeq = 1;
      if (latestOrder && latestOrder.production_order_no) {
        const parts = latestOrder.production_order_no.split('-');
        if (parts.length >= 4) {
          orderSeq = parseInt(parts[3], 10) + 1;
        }
      }
      const productionOrderNo = `FPCC-PO-${dateStr}-${String(orderSeq).padStart(2, '0')}`;
      const orderId = `ord-${Date.now()}`;

      // 3. Insert Production Order
      db.run(`
        INSERT INTO production_orders (
          id, production_order_no, sales_order_no, order_type, client_id, client_name,
          product_name, color_name, total_qty, target_etd, status, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Planning', ?)
      `, [
        orderId, productionOrderNo, `SO-${dateStr}-${String(orderSeq).padStart(2, '0')}`,
        orderType, clientId, clientName.trim(), productName.trim(), colorName.trim(),
        totalQty, targetEtd, clientComments || `Category: ${category}/${subCategory}. Freight: ${freightMode} (${freightCostTerms})`
      ]);

      // 4. Insert Order Size Matrix
      for (const [sz, qty] of Object.entries(cleanSizes)) {
        const matrixId = `osm-${Date.now()}-${sz}`;
        db.run('INSERT INTO order_size_matrix (id, production_order_id, size_label, order_qty, cut_qty, finished_qty, packed_qty) VALUES (?, ?, ?, ?, 0, 0, 0)',
          [matrixId, orderId, sz, qty]);
      }

      // 5. Trigger automated WhatsApp Order Confirmation log
      const cleanPhone = phone ? phone.replace(/[^0-9]/g, '') : '919822233445';
      const formattedPhone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;
      const whatsappMsg = `Hi ${clientName.trim()}! Your order ${productionOrderNo} for ${totalQty} pcs of ${productName.trim()} (${colorName.trim()}) has been confirmed with FPCC Textiles! Target dispatch ETD: ${targetEtd}. You can track progress live or reply STATUS ${productionOrderNo} anytime. Thank you!`;

      const logId = `wa-${Date.now()}`;
      db.run(`
        INSERT INTO whatsapp_logs (
          id, direction, phone_number, recipient_name, message_type,
          template_name, message_body, related_entity_type, related_entity_id, status
        ) VALUES (?, 'OUTBOUND', ?, ?, 'ORDER_CONFIRMATION', 'order_booking_ack', ?, 'Order', ?, 'DELIVERED')
      `, [logId, formattedPhone, clientName.trim(), whatsappMsg, productionOrderNo]);

      return {
        orderId,
        productionOrderNo,
        clientName: clientName.trim(),
        totalQty,
        targetEtd,
        whatsappNotificationSent: true
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Order creation error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
