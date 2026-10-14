const express = require('express');
const router = express.Router();
const db = require('../db');

function generateSequentialCode(prefix, table, column) {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
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

// 1. DYNAMIC COSTING & 4x MRP SIMULATOR
router.post('/costing/calculate', (req, res) => {
  try {
    const {
      fabricRatePerKg = 340.0,
      fabricAvgKgPerPc = 0.220,
      accessoriesCost = 15.0,
      cuttingCost = 8.0,
      stitchingCost = 35.0,
      finishingCost = 12.0,
      brandingCost = 25.0,
      rejectionBufferPct = 5.0,
      sellingPrice = null,
      taxBilling = 'extra', // 'included' or 'extra'
      isApparel = true
    } = req.body;

    const fabRate = parseFloat(fabricRatePerKg) || 0;
    const fabAvg = parseFloat(fabricAvgKgPerPc) || 0;
    const fabCost = Number((fabRate * fabAvg).toFixed(2));

    const directCost = fabCost +
      (parseFloat(accessoriesCost) || 0) +
      (parseFloat(cuttingCost) || 0) +
      (parseFloat(stitchingCost) || 0) +
      (parseFloat(finishingCost) || 0) +
      (parseFloat(brandingCost) || 0);

    const bufferRate = (parseFloat(rejectionBufferPct) || 0) / 100;
    const totalProductionCost = Number((directCost * (1 + bufferRate)).toFixed(2));
    
    // FPCC Formula: 4x Total Production Cost for MRP
    const targetMrp = Number((totalProductionCost * 4).toFixed(2));

    // Client Selling Price (default to ~1.4x production cost if not specified)
    const sp = sellingPrice !== null && sellingPrice !== undefined && parseFloat(sellingPrice) > 0
      ? parseFloat(sellingPrice)
      : Number((totalProductionCost * 1.45).toFixed(2));

    // Indian GST Tier Logic:
    // Apparel <= 2500 -> 5% GST; Apparel > 2500 -> 12% GST; Non-apparel -> 18% GST
    let taxRatePct = 5.0;
    if (!isApparel) {
      taxRatePct = 18.0;
    } else if (sp > 2500) {
      taxRatePct = 12.0;
    } else {
      taxRatePct = 5.0;
    }

    let netSp = sp;
    let taxAmount = 0;
    if (taxBilling === 'included') {
      netSp = Number((sp / (1 + (taxRatePct / 100))).toFixed(2));
      taxAmount = Number((sp - netSp).toFixed(2));
    } else {
      taxAmount = Number((sp * (taxRatePct / 100)).toFixed(2));
      netSp = sp;
    }

    const profitInr = Number((netSp - totalProductionCost).toFixed(2));
    const profitPct = Number(((profitInr / netSp) * 100).toFixed(2));

    res.json({
      success: true,
      data: {
        fabricCostPerPc: fabCost,
        directCost,
        totalProductionCost,
        targetMrp,
        sellingPrice: sp,
        netSellingPrice: netSp,
        taxRatePct,
        taxBilling,
        taxAmount,
        finalInvoicePricePerPc: taxBilling === 'extra' ? Number((sp + taxAmount).toFixed(2)) : sp,
        profitInr,
        profitPct
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 2. SAVE QUOTATION
router.post('/costing/save', (req, res) => {
  try {
    const {
      inquiryId,
      clientId,
      clientName,
      productName,
      colorName = 'Standard',
      sampleNo,
      qty = 100,
      fabricRatePerKg,
      fabricAvgKgPerPc,
      fabricCostPerPc,
      accessoriesCostPerPc,
      cuttingCostPerPc,
      stitchingCostPerPc,
      finishingCostPerPc,
      brandingCostPerPc,
      rejectionBufferPct,
      totalProductionCost,
      targetMrp,
      sellingPricePerPc,
      taxRatePct,
      taxBilling,
      taxAmountPerPc,
      profitInrPerPc,
      profitPct
    } = req.body;

    if (!clientName || !productName || !sellingPricePerPc) {
      return res.status(400).json({ success: false, error: 'Missing required quotation fields (clientName, productName, sellingPricePerPc)' });
    }

    const quotationNo = generateSequentialCode('QT', 'quotations_costing', 'quotation_no');
    const quoteId = `qt-${Date.now()}`;
    const totalOrderValue = Number((parseFloat(sellingPricePerPc) * parseInt(qty, 10)).toFixed(2));

    db.run(`
      INSERT INTO quotations_costing (
        id, quotation_no, inquiry_id, client_id, client_name, product_name, color_name,
        sample_no, qty, fabric_rate_per_kg, fabric_avg_kg_per_pc, fabric_cost_per_pc,
        accessories_cost_per_pc, cutting_cost_per_pc, stitching_cost_per_pc,
        finishing_cost_per_pc, branding_cost_per_pc, rejection_buffer_pct,
        total_production_cost, target_mrp, selling_price_per_pc, tax_rate_pct,
        tax_billing, tax_amount_per_pc, profit_inr_per_pc, profit_pct, total_order_value_inr,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Approved')
    `, [
      quoteId, quotationNo, inquiryId || null, clientId || null, clientName.trim(), productName.trim(), colorName.trim(),
      sampleNo || null, parseInt(qty, 10), parseFloat(fabricRatePerKg) || 340, parseFloat(fabricAvgKgPerPc) || 0.220,
      parseFloat(fabricCostPerPc) || 74.8, parseFloat(accessoriesCostPerPc) || 15, parseFloat(cuttingCostPerPc) || 8,
      parseFloat(stitchingCostPerPc) || 35, parseFloat(finishingCostPerPc) || 12, parseFloat(brandingCostPerPc) || 25,
      parseFloat(rejectionBufferPct) || 5, parseFloat(totalProductionCost) || 178, parseFloat(targetMrp) || 712,
      parseFloat(sellingPricePerPc), parseFloat(taxRatePct) || 5, taxBilling || 'extra',
      parseFloat(taxAmountPerPc) || 0, parseFloat(profitInrPerPc) || 0, parseFloat(profitPct) || 0,
      totalOrderValue
    ]);

    res.json({
      success: true,
      data: { quotationNo, id: quoteId, totalOrderValue }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 3. GET ALL INVOICES
router.get('/invoices', (req, res) => {
  try {
    const { status, clientName } = req.query;
    let sql = `
      SELECT i.*, p.product_name, p.color_name, p.total_qty
      FROM invoices i
      JOIN production_orders p ON i.production_order_no = p.production_order_no
    `;
    const params = [];
    const conds = [];
    if (status) {
      conds.push('i.payment_status = ?');
      params.push(status.trim());
    }
    if (clientName) {
      conds.push('i.client_name LIKE ?');
      params.push(`%${clientName.trim()}%`);
    }
    if (conds.length > 0) {
      sql += ' WHERE ' + conds.join(' AND ');
    }
    sql += ' ORDER BY i.created_at DESC';

    const invoices = db.query(sql, params);
    res.json({ success: true, count: invoices.length, data: invoices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. GENERATE TAX INVOICE AGAINST PRODUCTION ORDER
router.post('/invoices/generate', (req, res) => {
  try {
    const {
      productionOrderNo,
      unitPrice,
      freightAmount = 0.0,
      dueDate,
      eWayBillNo,
      carrier,
      docketNo,
      notes
    } = req.body;

    if (!productionOrderNo || !unitPrice) {
      return res.status(400).json({ success: false, error: 'productionOrderNo and unitPrice are required' });
    }

    const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
    if (!order) {
      return res.status(404).json({ success: false, error: `Order ${productionOrderNo} not found` });
    }

    const price = parseFloat(unitPrice);
    const subtotal = Number((price * order.total_qty).toFixed(2));
    
    // Indian GST tier
    const gstRate = price > 2500 ? 12.0 : 5.0;
    const gstAmount = Number((subtotal * (gstRate / 100)).toFixed(2));
    const freight = parseFloat(freightAmount) || 0.0;
    const totalAmount = Number((subtotal + gstAmount + freight).toFixed(2));

    const invoiceNo = generateSequentialCode('INV', 'invoices', 'invoice_no');
    const invoiceId = `inv-${Date.now()}`;

    db.run(`
      INSERT INTO invoices (
        id, invoice_no, production_order_no, client_id, client_name,
        invoice_date, due_date, subtotal_amount, gst_rate_pct, gst_amount,
        freight_amount, total_amount, amount_paid, balance_due, payment_status,
        e_way_bill_no, carrier, docket_no, notes
      ) VALUES (?, ?, ?, ?, ?, CURRENT_DATE, ?, ?, ?, ?, ?, ?, 0.0, ?, 'Unpaid', ?, ?, ?, ?)
    `, [
      invoiceId, invoiceNo, order.production_order_no, order.client_id, order.client_name,
      dueDate || null, subtotal, gstRate, gstAmount, freight, totalAmount, totalAmount,
      eWayBillNo || null, carrier || null, docketNo || null, notes || null
    ]);

    // Update order actual dispatch & carrier docket if provided
    if (docketNo) {
      db.run('UPDATE production_orders SET actual_dispatch_date = CURRENT_DATE WHERE id = ?', [order.id]);
    }

    res.json({
      success: true,
      data: {
        invoiceNo,
        invoiceId,
        productionOrderNo: order.production_order_no,
        totalAmount,
        gstAmount,
        balanceDue: totalAmount
      }
    });
  } catch (err) {
    console.error('Invoice generate error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// 5. RECORD CLIENT PAYMENT RECEIPT
router.post('/payments/record', (req, res) => {
  try {
    const {
      invoiceId,
      amount,
      paymentMode = 'NEFT_RTGS', // 'NEFT_RTGS', 'UPI', 'Cheque', 'Cash'
      referenceNo,
      notes
    } = req.body;

    if (!invoiceId || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'invoiceId and positive payment amount are required' });
    }

    const payAmt = parseFloat(amount);

    const result = db.transaction(() => {
      const invoice = db.get('SELECT * FROM invoices WHERE id = ? OR invoice_no = ?', [invoiceId, invoiceId]);
      if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      const paymentNo = generateSequentialCode('PAY', 'payments', 'payment_no');
      const paymentId = `pay-${Date.now()}`;

      db.run(`
        INSERT INTO payments (
          id, payment_no, invoice_id, client_id, payment_date, amount,
          payment_mode, reference_no, notes
        ) VALUES (?, ?, ?, ?, CURRENT_DATE, ?, ?, ?, ?)
      `, [
        paymentId, paymentNo, invoice.id, invoice.client_id, payAmt,
        paymentMode, referenceNo || null, notes || null
      ]);

      const newPaid = Number(((invoice.amount_paid || 0) + payAmt).toFixed(2));
      const newBalance = Number(Math.max(0, invoice.total_amount - newPaid).toFixed(2));
      const status = newBalance === 0 ? 'Paid' : 'Partially_Paid';

      db.run(`
        UPDATE invoices
        SET amount_paid = ?, balance_due = ?, payment_status = ?
        WHERE id = ?
      `, [newPaid, newBalance, status, invoice.id]);

      return {
        paymentNo,
        invoiceNo: invoice.invoice_no,
        amountReceived: payAmt,
        newBalanceDue: newBalance,
        status
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Payment record error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// 6. FINANCIAL OVERVIEW / ACCOUNTS RECEIVABLE SUMMARY
router.get('/summary', (req, res) => {
  try {
    const totalInvoiced = db.get('SELECT coalesce(sum(total_amount), 0) as total FROM invoices');
    const totalCollected = db.get('SELECT coalesce(sum(amount_paid), 0) as total FROM invoices');
    const accountsReceivable = db.get('SELECT coalesce(sum(balance_due), 0) as total FROM invoices');
    const unpaidCount = db.get("SELECT count(*) as count FROM invoices WHERE payment_status != 'Paid'");
    const totalQuotations = db.get('SELECT count(*) as count FROM quotations_costing');

    const recentInvoices = db.query(`
      SELECT invoice_no, client_name, invoice_date, total_amount, amount_paid, balance_due, payment_status
      FROM invoices ORDER BY created_at DESC LIMIT 6
    `);

    res.json({
      success: true,
      data: {
        totalInvoiced: Number(totalInvoiced.total.toFixed(2)),
        totalCollected: Number(totalCollected.total.toFixed(2)),
        accountsReceivable: Number(accountsReceivable.total.toFixed(2)),
        unpaidCount: unpaidCount.count,
        totalQuotations: totalQuotations.count,
        recentInvoices
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
