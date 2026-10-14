const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper to format Date to DDMMYY (e.g. 121026)
function getTodayDatePrefix() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

// 1. Dashboard statistics
router.get('/stats', (req, res) => {
  try {
    const totalRolls = db.get('SELECT count(*) as count FROM fabric_bundles');
    const totalFabricKg = db.get("SELECT coalesce(sum(available_qty), 0) as total FROM fabric_bundles WHERE material_sub_type = 'Fabric'");
    const totalLots = db.get('SELECT count(*) as count FROM parent_inward_lots');
    const totalAccessories = db.get('SELECT count(*) as count FROM accessory_items');
    const pendingQc = db.get("SELECT count(*) as count FROM fabric_bundles WHERE qc_status = 'PENDING'");
    const totalLedgerTxns = db.get('SELECT count(*) as count FROM inventory_stock_ledger');

    const recentTxns = db.query(`
      SELECT id, txn_date, txn_type, parent_code, bundle_code, production_order_no, 
             item_name, color_name, qty_in, qty_out, balance_after, location_bin, performed_by
      FROM inventory_stock_ledger 
      ORDER BY txn_date DESC LIMIT 10
    `);

    res.json({
      success: true,
      data: {
        totalRolls: totalRolls.count,
        totalFabricKg: Number(totalFabricKg.total.toFixed(3)),
        totalLots: totalLots.count,
        totalAccessories: totalAccessories.count,
        pendingQc: pendingQc.count,
        totalLedgerTxns: totalLedgerTxns.count,
        recentTxns
      }
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Suggest next sequential Parent Code for today
router.get('/next-parent-code', (req, res) => {
  try {
    const prefix = getTodayDatePrefix();
    // find all parent codes starting with prefix
    const existing = db.query('SELECT parent_code FROM parent_inward_lots WHERE parent_code LIKE ? ORDER BY parent_code DESC', [`${prefix}-%`]);
    
    let nextLetter = 'A';
    if (existing.length > 0) {
      const lastCode = existing[0].parent_code; // e.g. 121026-B
      const parts = lastCode.split('-');
      if (parts.length > 1) {
        const lastChar = parts[1].trim().toUpperCase();
        nextLetter = String.fromCharCode(lastChar.charCodeAt(0) + 1);
      }
    }

    res.json({
      success: true,
      suggestedCode: `${prefix}-${nextLetter}`,
      todayPrefix: prefix,
      existingCountToday: existing.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. List Parent Inward Lots
router.get('/lots', (req, res) => {
  try {
    const lots = db.query(`
      SELECT p.*, e.name as vendor_name,
        (SELECT count(*) FROM fabric_bundles WHERE parent_code = p.parent_code) as bundle_count,
        (SELECT coalesce(sum(available_qty), 0) FROM fabric_bundles WHERE parent_code = p.parent_code) as current_available_qty
      FROM parent_inward_lots p
      LEFT JOIN entities e ON p.vendor_id = e.id
      ORDER BY p.inward_date DESC, p.parent_code DESC
    `);
    res.json({ success: true, data: lots });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Create Parent Inward Lot & Batch Generate Child Bundles
router.post('/inward', (req, res) => {
  try {
    const {
      parentCode,
      inwardDate,
      vendorId,
      invoiceNo,
      inwardType = 'Fabric',
      vendorFabName,
      vendorColor,
      fabricName,
      colorName,
      uom = 'kg',
      invoiceQty,
      rate,
      remarks,
      performedBy = 'usr-aniket',
      bundles = [] // Array of { weight, gsm, width, location }
    } = req.body;

    if (!parentCode || !vendorId || !invoiceNo || !invoiceQty) {
      return res.status(400).json({ success: false, error: 'Missing required inward fields (parentCode, vendorId, invoiceNo, invoiceQty)' });
    }

    const cleanParentCode = parentCode.trim().toUpperCase();
    const cleanInwardDate = inwardDate || new Date().toISOString().split('T')[0];
    const totalBundlesCount = bundles.length > 0 ? bundles.length : 1;

    // Execute atomically in transaction
    const result = db.transaction(() => {
      // 1. Check if parent lot already exists (for dye lot multi-component reuse: e.g. adding collar to fabric lot)
      let parentLot = db.get('SELECT * FROM parent_inward_lots WHERE parent_code = ?', [cleanParentCode]);
      let lotId;

      const physicalSum = bundles.reduce((acc, b) => acc + (parseFloat(b.weight) || 0), 0);
      const shortfall = (parseFloat(invoiceQty) || 0) - physicalSum;

      if (!parentLot) {
        lotId = `lot-${cleanParentCode.toLowerCase()}`;
        db.run(`
          INSERT INTO parent_inward_lots 
          (id, parent_code, inward_date, vendor_id, invoice_no, inward_type, vendor_fab_name, vendor_color, no_of_bundles, uom, invoice_qty, inward_physical_qty, shortfall_qty, rate, remarks, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          lotId, cleanParentCode, cleanInwardDate, vendorId, invoiceNo, inwardType,
          vendorFabName || fabricName, vendorColor || colorName, totalBundlesCount, uom,
          parseFloat(invoiceQty), physicalSum, shortfall, rate ? parseFloat(rate) : null,
          remarks || null, performedBy
        ]);
      } else {
        lotId = parentLot.id;
        // Update physical qty and bundle count
        const updatedPhysical = (parentLot.inward_physical_qty || 0) + physicalSum;
        const updatedShortfall = (parentLot.invoice_qty || 0) - updatedPhysical;
        const updatedBundleCount = (parentLot.no_of_bundles || 0) + totalBundlesCount;
        db.run(`
          UPDATE parent_inward_lots 
          SET inward_physical_qty = ?, shortfall_qty = ?, no_of_bundles = ?
          WHERE id = ?
        `, [updatedPhysical, updatedShortfall, updatedBundleCount, lotId]);
      }

      // 2. Insert bundles and write to double-entry stock ledger
      const createdBundles = [];
      const totalCountPad = String(totalBundlesCount).padStart(2, '0');

      bundles.forEach((b, index) => {
        const seq = index + 1;
        const seqPad = String(seq).padStart(2, '0');
        const bundleCode = `${cleanParentCode}-${seqPad}/${totalCountPad}`;
        const bundleId = `bun-${bundleCode.replace(/[\/\-]/g, '_')}`;
        const weight = parseFloat(b.weight) || 0;
        const gsm = b.gsm ? parseFloat(b.gsm) : (b.defaultGsm || 200);
        const width = b.width ? parseFloat(b.width) : 60;
        const loc = (b.location || 'R1-B01').trim();
        const fab = (fabricName || vendorFabName || 'Textile Roll').trim();
        const col = (colorName || vendorColor || 'Standard').trim();

        const qrPayload = JSON.stringify({
          fpcc: 'roll',
          code: bundleCode,
          lot: cleanParentCode,
          fab: fab,
          col: col,
          gsm: gsm,
          qty: weight,
          loc: loc
        });

        db.run(`
          INSERT INTO fabric_bundles 
          (id, bundle_code, parent_lot_id, parent_code, bundle_sequence, total_bundles, fabric_name, color_name, material_sub_type, bundle_gsm, bundle_width, original_qty, available_qty, issued_qty, location_bin, qc_status, qr_payload)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, ?, 'PASSED', ?)
        `, [
          bundleId, bundleCode, lotId, cleanParentCode, seq, totalBundlesCount,
          fab, col, inwardType, gsm, width, weight, weight, loc, qrPayload
        ]);

        // Write INWARD transaction to Stock Ledger
        const ledgerId = `tx-${Date.now()}-${seq}`;
        db.run(`
          INSERT INTO inventory_stock_ledger 
          (id, txn_date, txn_type, parent_code, bundle_code, material_type, item_name, color_name, uom, qty_in, qty_out, balance_after, location_bin, performed_by, remarks)
          VALUES (?, CURRENT_TIMESTAMP, 'INWARD', ?, ?, ?, ?, ?, ?, ?, 0.0, ?, ?, ?, ?)
        `, [
          ledgerId, cleanParentCode, bundleCode, inwardType, fab, col, uom,
          weight, weight, loc, performedBy, `Gate inward batch verified roll ${seq}/${totalBundlesCount}`
        ]);

        createdBundles.push({
          bundleCode,
          weight,
          gsm,
          location: loc,
          qrPayload
        });
      });

      return {
        parentCode: cleanParentCode,
        lotId,
        createdBundlesCount: createdBundles.length,
        createdBundles
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Inward error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. List all Fabric Bundles / Rolls with filtering
router.get('/bundles', (req, res) => {
  try {
    const { parentCode, fabricName, colorName, status, search } = req.query;
    let sql = 'SELECT * FROM fabric_bundles WHERE 1=1';
    const params = [];

    if (parentCode) {
      sql += ' AND parent_code = ?';
      params.push(parentCode.trim());
    }
    if (fabricName) {
      sql += ' AND fabric_name = ?';
      params.push(fabricName.trim());
    }
    if (colorName) {
      sql += ' AND color_name = ?';
      params.push(colorName.trim());
    }
    if (status === 'available') {
      sql += ' AND available_qty > 0';
    } else if (status === 'exhausted') {
      sql += ' AND available_qty <= 0';
    }
    if (search) {
      sql += ' AND (bundle_code LIKE ? OR parent_code LIKE ? OR fabric_name LIKE ? OR color_name LIKE ? OR location_bin LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s, s);
    }

    sql += ' ORDER BY created_at DESC, bundle_code ASC';
    const bundles = db.query(sql, params);

    res.json({ success: true, count: bundles.length, data: bundles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Material Issue / Outward to Production Order
router.post('/issue', (req, res) => {
  try {
    const {
      productionOrderNo,
      bundleCode,
      issuedQty, // kg or pcs to issue
      performedBy = 'usr-aniket',
      remarks
    } = req.body;

    if (!productionOrderNo || !bundleCode || !issuedQty) {
      return res.status(400).json({ success: false, error: 'Missing required issue fields (productionOrderNo, bundleCode, issuedQty)' });
    }

    const qtyToIssue = parseFloat(issuedQty);
    if (qtyToIssue <= 0) {
      return res.status(400).json({ success: false, error: 'Issued quantity must be greater than zero' });
    }

    const result = db.transaction(() => {
      // 1. Verify bundle
      const bundle = db.get('SELECT * FROM fabric_bundles WHERE bundle_code = ?', [bundleCode.trim()]);
      if (!bundle) {
        throw new Error(`Bundle ${bundleCode} not found in warehouse`);
      }

      if (bundle.available_qty < qtyToIssue) {
        throw new Error(`Insufficient stock: Bundle ${bundleCode} has ${bundle.available_qty} kg available, cannot issue ${qtyToIssue} kg`);
      }

      // 2. Verify order
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
      if (!order) {
        throw new Error(`Production Order ${productionOrderNo} not found`);
      }

      // Dye lot validation notice
      const isColorMatch = !order.color_name || (order.color_name.toLowerCase() === bundle.color_name.toLowerCase());

      // 3. Deduct stock from bundle
      const newAvailable = Number((bundle.available_qty - qtyToIssue).toFixed(3));
      const newIssued = Number(((bundle.issued_qty || 0) + qtyToIssue).toFixed(3));

      db.run(`
        UPDATE fabric_bundles 
        SET available_qty = ?, issued_qty = ?
        WHERE id = ?
      `, [newAvailable, newIssued, bundle.id]);

      // 4. Record ISSUE_PRODUCTION in Stock Ledger
      const ledgerId = `tx-iss-${Date.now()}`;
      db.run(`
        INSERT INTO inventory_stock_ledger 
        (id, txn_date, txn_type, parent_code, bundle_code, production_order_no, material_type, item_name, color_name, uom, qty_in, qty_out, balance_after, location_bin, performed_by, remarks)
        VALUES (?, CURRENT_TIMESTAMP, 'ISSUE_PRODUCTION', ?, ?, ?, ?, ?, ?, 'kg', 0.0, ?, ?, ?, ?, ?)
      `, [
        ledgerId, bundle.parent_code, bundle.bundle_code, order.production_order_no,
        bundle.material_sub_type, bundle.fabric_name, bundle.color_name,
        qtyToIssue, newAvailable, bundle.location_bin, performedBy,
        remarks || `Issued to cutting floor for order ${order.production_order_no}`
      ]);

      return {
        bundleCode: bundle.bundle_code,
        productionOrderNo: order.production_order_no,
        issuedQty: qtyToIssue,
        remainingAvailable: newAvailable,
        colorMatch: isColorMatch,
        colorWarning: !isColorMatch ? `Warning: Bundle color '${bundle.color_name}' does not strictly match order color '${order.color_name}'` : null
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Issue error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// 7. Material Return from Production
router.post('/return', (req, res) => {
  try {
    const {
      bundleCode,
      productionOrderNo,
      returnQty, // Remaining weight being returned to shelf
      performedBy = 'usr-aniket',
      remarks
    } = req.body;

    if (!bundleCode || !returnQty) {
      return res.status(400).json({ success: false, error: 'Missing required return fields (bundleCode, returnQty)' });
    }

    const qtyReturned = parseFloat(returnQty);
    if (qtyReturned < 0) {
      return res.status(400).json({ success: false, error: 'Return quantity cannot be negative' });
    }

    const result = db.transaction(() => {
      const bundle = db.get('SELECT * FROM fabric_bundles WHERE bundle_code = ?', [bundleCode.trim()]);
      if (!bundle) {
        throw new Error(`Bundle ${bundleCode} not found`);
      }

      const newAvailable = Number((bundle.available_qty + qtyReturned).toFixed(3));
      const newIssued = Number(Math.max(0, (bundle.issued_qty || 0) - qtyReturned).toFixed(3));

      db.run(`
        UPDATE fabric_bundles 
        SET available_qty = ?, issued_qty = ?
        WHERE id = ?
      `, [newAvailable, newIssued, bundle.id]);

      // Record RETURN_PRODUCTION in Stock Ledger
      const ledgerId = `tx-ret-${Date.now()}`;
      db.run(`
        INSERT INTO inventory_stock_ledger 
        (id, txn_date, txn_type, parent_code, bundle_code, production_order_no, material_type, item_name, color_name, uom, qty_in, qty_out, balance_after, location_bin, performed_by, remarks)
        VALUES (?, CURRENT_TIMESTAMP, 'RETURN_PRODUCTION', ?, ?, ?, ?, ?, ?, 'kg', ?, 0.0, ?, ?, ?, ?)
      `, [
        ledgerId, bundle.parent_code, bundle.bundle_code, productionOrderNo || null,
        bundle.material_sub_type, bundle.fabric_name, bundle.color_name,
        qtyReturned, newAvailable, bundle.location_bin, performedBy,
        remarks || `Returned unconsumed balance from cutting`
      ]);

      const netConsumedByJob = Number((bundle.original_qty - newAvailable).toFixed(3));

      return {
        bundleCode: bundle.bundle_code,
        returnedQty: qtyReturned,
        newAvailableStock: newAvailable,
        netConsumedByJob
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Return error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// 8. Perpetual Stock Ledger Query
router.get('/ledger', (req, res) => {
  try {
    const { parentCode, bundleCode, orderNo, txnType, limit = 100 } = req.query;
    let sql = 'SELECT * FROM inventory_stock_ledger WHERE 1=1';
    const params = [];

    if (parentCode) {
      sql += ' AND parent_code = ?';
      params.push(parentCode.trim());
    }
    if (bundleCode) {
      sql += ' AND bundle_code = ?';
      params.push(bundleCode.trim());
    }
    if (orderNo) {
      sql += ' AND production_order_no = ?';
      params.push(orderNo.trim());
    }
    if (txnType) {
      sql += ' AND txn_type = ?';
      params.push(txnType.trim());
    }

    sql += ' ORDER BY txn_date DESC LIMIT ?';
    params.push(parseInt(limit));

    const entries = db.query(sql, params);
    res.json({ success: true, count: entries.length, data: entries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Generate 4"x2" Twin Thermal Sticker Code (TSPL, ZPL, and SVG format)
router.get('/label', handleLabelRequest);
router.get('/label/*', handleLabelRequest);

function handleLabelRequest(req, res) {
  try {
    const rawParam = req.params[0] || req.params.bundleCode || req.query.code || '';
    const bundleCode = decodeURIComponent(rawParam).trim();
    const bundle = db.get('SELECT * FROM fabric_bundles WHERE bundle_code = ?', [bundleCode]);
    if (!bundle) {
      return res.status(404).json({ success: false, error: `Bundle '${bundleCode}' not found` });
    }

    // TSPL format for TSC/Xprinter thermal printers (4x2 inches @ 203 DPI = 812 x 406 dots)
    const tsplCommands = [
      'SIZE 4,2',
      'GAP 0.12,0',
      'DIRECTION 1',
      'CLS',
      // Outer border & header
      'BOX 20,20,792,386,3',
      'TEXT 40,40,"3",0,1,1,"FPCC TEXTILES - ROLL TAG"',
      `TEXT 40,80,"3",0,1,1,"ROLL: ${bundle.bundle_code}"`,
      `TEXT 40,120,"2",0,1,1,"LOT : ${bundle.parent_code} | GSM: ${bundle.bundle_gsm}"`,
      `TEXT 40,150,"2",0,1,1,"FAB : ${bundle.fabric_name}"`,
      `TEXT 40,180,"2",0,1,1,"COL : ${bundle.color_name}"`,
      `TEXT 40,210,"3",0,1,1,"NET WT: ${bundle.available_qty} KG"`,
      `TEXT 40,250,"2",0,1,1,"BIN : ${bundle.location_bin} | QC: ${bundle.qc_status}"`,
      // QR Code on right side
      `QRCODE 550,60,L,6,A,0,"${bundle.bundle_code}"`,
      'PRINT 2,1' // Prints twin stickers!
    ].join('\n');

    // ZPL format for Zebra printers
    const zplCommands = [
      '^XA',
      '^FO40,40^A0N,30,30^FDFPCC TEXTILES - ROLL TAG^FS',
      `^FO40,80^A0N,35,35^FDROLL: ${bundle.bundle_code}^FS`,
      `^FO40,125^A0N,25,25^FDLOT: ${bundle.parent_code} | GSM: ${bundle.bundle_gsm}^FS`,
      `^FO40,160^A0N,25,25^FDFAB: ${bundle.fabric_name}^FS`,
      `^FO40,195^A0N,25,25^FDCOL: ${bundle.color_name}^FS`,
      `^FO40,230^A0N,35,35^FDNET WT: ${bundle.available_qty} KG^FS`,
      `^FO40,275^A0N,25,25^FDBIN: ${bundle.location_bin} | QC: ${bundle.qc_status}^FS`,
      `^FO550,60^BQN,2,6^FDLA,${bundle.bundle_code}^FS`,
      '^PQ2', // Prints twin stickers
      '^XZ'
    ].join('\n');

    res.json({
      success: true,
      data: {
        bundle,
        tsplCommands,
        zplCommands
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = router;
