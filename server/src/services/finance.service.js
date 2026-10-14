const db = require('../db');
const { generateSequentialCode, round } = require('../utils');
const config = require('../config');
const { eventBus, EVENTS } = require('./events.service');

const financeService = {
  /**
   * Costing & 4x MRP Simulator with Indian GST Tier Logic
   */
  calculateCosting({
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
  }) {
    const fabRate = parseFloat(fabricRatePerKg) || 0;
    const fabAvg = parseFloat(fabricAvgKgPerPc) || 0;
    const fabCost = round(fabRate * fabAvg, 2);

    const directCost = round(
      fabCost +
      (parseFloat(accessoriesCost) || 0) +
      (parseFloat(cuttingCost) || 0) +
      (parseFloat(stitchingCost) || 0) +
      (parseFloat(finishingCost) || 0) +
      (parseFloat(brandingCost) || 0),
      2
    );

    const bufferRate = (parseFloat(rejectionBufferPct) || 0) / 100;
    const totalProductionCost = round(directCost * (1 + bufferRate), 2);

    // 4x MRP multiplier (Apparel industry benchmark)
    const multiplier = (config.pricing && config.pricing.mrpMultiplier) || 4.0;
    const targetMrp = round(totalProductionCost * multiplier, 2);

    // Wholesale selling price (default to ~1.45x if not provided)
    const sp = sellingPrice !== null && sellingPrice !== undefined && parseFloat(sellingPrice) > 0
      ? parseFloat(sellingPrice)
      : round(totalProductionCost * 1.45, 2);

    // Indian GST Tier:
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
      netSp = round(sp / (1 + (taxRatePct / 100)), 2);
      taxAmount = round(sp - netSp, 2);
    } else {
      taxAmount = round(sp * (taxRatePct / 100), 2);
      netSp = sp;
    }

    const profitInr = round(netSp - totalProductionCost, 2);
    const profitPct = round((profitInr / netSp) * 100, 2);

    return {
      fabricCostPerPc: fabCost,
      directCost,
      totalProductionCost,
      targetMrp,
      sellingPrice: sp,
      netSellingPrice: netSp,
      taxRatePct,
      taxBilling,
      taxAmount,
      finalInvoicePricePerPc: taxBilling === 'extra' ? round(sp + taxAmount, 2) : sp,
      profitInr,
      profitPct
    };
  },

  /**
   * Save formal quotation for inquiry or customer
   */
  createQuotation({
    inquiryId = null,
    clientId = null,
    clientName,
    productName,
    colorName = 'Standard',
    sampleNo = null,
    qty = 100,
    costingParams = {},
    userId = 'system'
  }) {
    if (!clientName || !productName) {
      throw new Error('clientName and productName are required');
    }

    const calculated = this.calculateCosting(costingParams);
    const quotationNo = generateSequentialCode('QT', 'quotations_costing', 'quotation_no');
    const quoteId = `qt-${Date.now()}`;
    const quantity = parseInt(qty, 10) || 100;
    const totalOrderValue = round(calculated.sellingPrice * quantity, 2);

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
      quoteId, quotationNo, inquiryId, clientId, clientName.trim(), productName.trim(), colorName.trim(),
      sampleNo, quantity, parseFloat(costingParams.fabricRatePerKg) || 340,
      parseFloat(costingParams.fabricAvgKgPerPc) || 0.220, calculated.fabricCostPerPc,
      parseFloat(costingParams.accessoriesCost) || 15, parseFloat(costingParams.cuttingCost) || 8,
      parseFloat(costingParams.stitchingCost) || 35, parseFloat(costingParams.finishingCost) || 12,
      parseFloat(costingParams.brandingCost) || 25, parseFloat(costingParams.rejectionBufferPct) || 5,
      calculated.totalProductionCost, calculated.targetMrp, calculated.sellingPrice,
      calculated.taxRatePct, costingParams.taxBilling || 'extra', calculated.taxAmount,
      calculated.profitInr, calculated.profitPct, totalOrderValue
    ]);

    db.audit(
      userId,
      userId,
      'FINANCE',
      'QUOTATION_CREATED',
      'quotations_costing',
      quotationNo,
      null,
      { quotationNo, clientName, totalOrderValue, targetMrp: calculated.targetMrp },
      `Quotation ${quotationNo} generated for ${clientName}: ₹${totalOrderValue}`
    );

    return {
      quoteId,
      quotationNo,
      clientName,
      productName,
      qty: quantity,
      costing: calculated,
      totalOrderValue
    };
  },

  /**
   * Generate Statutory Tax Invoice
   */
  generateInvoice({
    productionOrderNo,
    unitPrice,
    freightAmount = 0.0,
    dueDate = null,
    eWayBillNo = null,
    carrier = null,
    docketNo = null,
    notes = null,
    userId = 'system'
  }) {
    if (!productionOrderNo || !unitPrice) {
      throw new Error('productionOrderNo and unitPrice are required');
    }

    return db.transaction(() => {
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
      if (!order) throw new Error(`Production Order '${productionOrderNo}' not found`);

      const price = parseFloat(unitPrice);
      const subtotal = round(price * order.total_qty, 2);

      const gstRate = price > 2500 ? 12.0 : 5.0;
      const gstAmount = round(subtotal * (gstRate / 100), 2);
      const freight = parseFloat(freightAmount) || 0.0;
      const totalAmount = round(subtotal + gstAmount + freight, 2);

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
        dueDate, subtotal, gstRate, gstAmount, freight, totalAmount, totalAmount,
        eWayBillNo, carrier, docketNo, notes
      ]);

      db.audit(
        userId,
        userId,
        'FINANCE',
        'INVOICE_GENERATED',
        'invoices',
        invoiceNo,
        null,
        { invoiceNo, productionOrderNo: order.production_order_no, totalAmount, gstAmount },
        `Tax Invoice ${invoiceNo} issued to ${order.client_name}: ₹${totalAmount}`
      );

      return {
        invoiceId,
        invoiceNo,
        productionOrderNo: order.production_order_no,
        clientName: order.client_name,
        subtotal,
        gstRate,
        gstAmount,
        freightAmount: freight,
        totalAmount,
        balanceDue: totalAmount,
        status: 'Unpaid'
      };
    });
  },

  /**
   * Record Customer Payment Receipt with UTR Reconciliation
   */
  recordPayment({
    invoiceId,
    amount,
    paymentMode = 'NEFT_RTGS', // 'NEFT_RTGS', 'UPI', 'Cheque', 'Cash'
    referenceNo = null,
    notes = null,
    userId = 'system'
  }) {
    if (!invoiceId || !amount || parseFloat(amount) <= 0) {
      throw new Error('invoiceId and positive payment amount are required');
    }

    const payAmt = parseFloat(amount);

    return db.transaction(() => {
      const invoice = db.get('SELECT * FROM invoices WHERE id = ? OR invoice_no = ?', [invoiceId, invoiceId]);
      if (!invoice) throw new Error(`Invoice '${invoiceId}' not found`);

      const paymentNo = generateSequentialCode('PAY', 'payments', 'payment_no');
      const paymentId = `pay-${Date.now()}`;

      db.run(`
        INSERT INTO payments (
          id, payment_no, invoice_id, client_id, payment_date, amount,
          payment_mode, reference_no, notes
        ) VALUES (?, ?, ?, ?, CURRENT_DATE, ?, ?, ?, ?)
      `, [
        paymentId, paymentNo, invoice.id, invoice.client_id, payAmt,
        paymentMode, referenceNo, notes
      ]);

      const newPaid = round((invoice.amount_paid || 0) + payAmt, 2);
      const newBalance = round(Math.max(0, invoice.total_amount - newPaid), 2);
      const status = newBalance <= 0.01 ? 'Paid' : 'Partially_Paid';

      db.run(`
        UPDATE invoices
        SET amount_paid = ?, balance_due = ?, payment_status = ?
        WHERE id = ?
      `, [newPaid, newBalance, status, invoice.id]);

      db.audit(
        userId,
        userId,
        'FINANCE',
        'PAYMENT_RECORDED',
        'payments',
        paymentNo,
        { previousBalance: invoice.balance_due },
        { paymentNo, amountReceived: payAmt, newBalance, referenceNo },
        `Payment ${paymentNo} received: ₹${payAmt} for ${invoice.invoice_no} (Mode: ${paymentMode})`
      );

      return {
        paymentNo,
        invoiceNo: invoice.invoice_no,
        amountReceived: payAmt,
        newAmountPaid: newPaid,
        newBalanceDue: newBalance,
        status
      };
    });
  },

  /**
   * Generate Order Completion Report (OCR) - Post-Mortem Reconciliation
   */
  generateOrderCompletionReport(productionOrderNo, { closedBy = 'usr-aniket', userId = 'system' } = {}) {
    if (!productionOrderNo) throw new Error('productionOrderNo is required');

    return db.transaction(() => {
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
      if (!order) throw new Error(`Production Order '${productionOrderNo}' not found`);

      // 1. Piece Reconciliations
      const plannedPcs = order.total_qty || 0;
      const cutRow = db.get(
        'SELECT coalesce(sum(total_pcs_cut), 0) as total FROM cutting_jobs WHERE production_order_no = ?',
        [order.production_order_no]
      );
      const totalCutPcs = cutRow ? cutRow.total : 0;

      const packRow = db.get(
        'SELECT coalesce(sum(total_pcs), 0) as total FROM carton_packings WHERE production_order_no = ?',
        [order.production_order_no]
      );
      const totalPackedPcs = packRow ? packRow.total : 0;

      const surplusOverrunPcs = Math.max(0, totalPackedPcs - plannedPcs);
      const shortagePcs = Math.max(0, plannedPcs - totalPackedPcs);

      // 2. Fabric Reconciliations
      const bomAlloc = db.get(
        "SELECT required_qty FROM order_bom_allocations WHERE production_order_no = ? AND item_type = 'Fabric'",
        [order.production_order_no]
      );
      const plannedFabricKg = bomAlloc ? bomAlloc.required_qty : round(plannedPcs * 0.220, 2);

      const fabricIssuedRow = db.get(
        "SELECT coalesce(sum(qty_out), 0) as total FROM inventory_stock_ledger WHERE production_order_no = ? AND txn_type = 'ISSUE_PRODUCTION'",
        [order.production_order_no]
      );
      const actualFabricIssuedKg = fabricIssuedRow ? fabricIssuedRow.total : 0;

      const remnantRow = db.get(
        "SELECT coalesce(sum(qty_in), 0) as total FROM inventory_stock_ledger WHERE production_order_no = ? AND txn_type = 'RETURN_PRODUCTION'",
        [order.production_order_no]
      );
      const remnantReturnedKg = remnantRow ? remnantRow.total : 0;
      const netFabricConsumedKg = round(Math.max(0, actualFabricIssuedKg - remnantReturnedKg), 3);
      const fabricScrapKg = round(Math.max(0, netFabricConsumedKg - (totalCutPcs * 0.200)), 3);

      const plannedAvgKg = plannedPcs > 0 ? round(plannedFabricKg / plannedPcs, 4) : 0;
      const actualAvgKg = totalCutPcs > 0 ? round(netFabricConsumedKg / totalCutPcs, 4) : 0;
      const fabricEfficiencyPct = plannedAvgKg > 0 && actualAvgKg > 0 ? round((plannedAvgKg / actualAvgKg) * 100, 2) : 100.0;

      // 3. Financial Reconciliations
      const invRow = db.get(
        'SELECT coalesce(sum(total_amount), 0) as total FROM invoices WHERE production_order_no = ?',
        [order.production_order_no]
      );
      const totalInvoiceValue = invRow ? invRow.total : 0;

      const debitRow = db.get(
        'SELECT coalesce(sum(total_debit_amount), 0) as total FROM debit_notes WHERE production_order_no = ?',
        [order.production_order_no]
      );
      const totalVendorDebitRecovery = debitRow ? debitRow.total : 0;

      // Cost estimates
      const materialCost = round(netFabricConsumedKg * 340.0 + (totalCutPcs * 15.0), 2);
      const labourCost = round(totalCutPcs * (8.0 + 35.0 + 12.0 + 25.0), 2);
      const reworkCost = round(shortagePcs * 25.0, 2);
      const netProductionCost = round(materialCost + labourCost + reworkCost - totalVendorDebitRecovery, 2);

      const grossRealizedProfit = round(totalInvoiceValue - netProductionCost, 2);
      const realizedProfitPct = totalInvoiceValue > 0 ? round((grossRealizedProfit / totalInvoiceValue) * 100, 2) : 0;
      const quotedProfitPct = 25.0; // Benchmark quote margin
      const marginVariancePct = round(realizedProfitPct - quotedProfitPct, 2);

      const ocrNo = generateSequentialCode('OCR', 'order_completion_reports', 'ocr_no');
      const ocrId = `ocr-${Date.now()}`;

      db.run(`
        INSERT INTO order_completion_reports (
          id, ocr_no, production_order_no, client_name, product_name, color_name,
          total_planned_pcs, total_cut_pcs, total_packed_pcs, surplus_overrun_pcs, shortage_pcs,
          planned_fabric_kg, actual_fabric_issued_kg, fabric_remnant_returned_kg,
          net_fabric_consumed_kg, fabric_scrap_kg, planned_fabric_avg_kg_per_pc,
          actual_fabric_avg_kg_per_pc, fabric_efficiency_pct, total_invoice_value_inr,
          total_material_cost_inr, total_labour_operations_cost_inr, total_rework_cost_inr,
          total_vendor_debit_recovery_inr, net_actual_production_cost_inr,
          gross_realized_profit_inr, realized_profit_pct, quoted_profit_pct,
          margin_variance_pct, closure_status, closed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?)
      `, [
        ocrId, ocrNo, order.production_order_no, order.client_name, order.product_name, order.color_name,
        plannedPcs, totalCutPcs, totalPackedPcs, surplusOverrunPcs, shortagePcs,
        plannedFabricKg, actualFabricIssuedKg, remnantReturnedKg,
        netFabricConsumedKg, fabricScrapKg, plannedAvgKg,
        actualAvgKg, fabricEfficiencyPct, totalInvoiceValue,
        materialCost, labourCost, reworkCost,
        totalVendorDebitRecovery, netProductionCost,
        grossRealizedProfit, realizedProfitPct, quotedProfitPct,
        marginVariancePct, closedBy
      ]);

      // Set order status to Completed
      db.run("UPDATE production_orders SET status = 'Completed' WHERE id = ?", [order.id]);

      db.audit(
        userId,
        closedBy,
        'FINANCE',
        'OCR_GENERATED',
        'order_completion_reports',
        ocrNo,
        null,
        { ocrNo, productionOrderNo: order.production_order_no, grossRealizedProfit, realizedProfitPct },
        `Order Completion Report ${ocrNo} closed: Realized Profit ₹${grossRealizedProfit} (${realizedProfitPct}%)`
      );

      return {
        ocrId,
        ocrNo,
        productionOrderNo: order.production_order_no,
        plannedPcs,
        totalCutPcs,
        totalPackedPcs,
        plannedFabricKg,
        netFabricConsumedKg,
        fabricEfficiencyPct,
        totalInvoiceValue,
        netProductionCost,
        grossRealizedProfit,
        realizedProfitPct,
        marginVariancePct,
        closureStatus: 'COMPLETED'
      };
    });
  },

  /**
   * Get overall financial summary
   */
  getFinancialSummary() {
    const totalInvoiced = db.get('SELECT coalesce(sum(total_amount), 0) as total FROM invoices');
    const totalCollected = db.get('SELECT coalesce(sum(amount_paid), 0) as total FROM invoices');
    const accountsReceivable = db.get('SELECT coalesce(sum(balance_due), 0) as total FROM invoices');
    const unpaidCount = db.get("SELECT count(*) as count FROM invoices WHERE payment_status != 'Paid'");
    const totalQuotations = db.get('SELECT count(*) as count FROM quotations_costing');

    const recentInvoices = db.query(`
      SELECT invoice_no, client_name, invoice_date, total_amount, amount_paid, balance_due, payment_status
      FROM invoices ORDER BY created_at DESC LIMIT 6
    `);

    return {
      totalInvoiced: round(totalInvoiced.total, 2),
      totalCollected: round(totalCollected.total, 2),
      accountsReceivable: round(accountsReceivable.total, 2),
      unpaidCount: unpaidCount.count,
      totalQuotations: totalQuotations.count,
      recentInvoices
    };
  }
};

module.exports = financeService;
