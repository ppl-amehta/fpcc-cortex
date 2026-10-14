const db = require('../db');
const { round } = require('../utils');
const { eventBus, EVENTS } = require('./events.service');

function getTodayDatePrefix() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

const inventoryService = {
  /**
   * Suggest next sequential parent lot code (e.g. 141026-A, 141026-B)
   */
  suggestNextParentCode() {
    const prefix = getTodayDatePrefix();
    const existing = db.query(
      'SELECT parent_code FROM parent_inward_lots WHERE parent_code LIKE ? ORDER BY parent_code DESC',
      [`${prefix}-%`]
    );

    let nextLetter = 'A';
    if (existing.length > 0) {
      const lastCode = existing[0].parent_code;
      const parts = lastCode.split('-');
      if (parts.length > 1) {
        const lastChar = parts[1].trim().toUpperCase();
        nextLetter = String.fromCharCode(lastChar.charCodeAt(0) + 1);
      }
    }

    return {
      suggestedCode: `${prefix}-${nextLetter}`,
      todayPrefix: prefix,
      existingCountToday: existing.length
    };
  },

  /**
   * Inward Parent Lot and batch create Roll Bundles or Accessories
   */
  inwardParentLot({
    parentCode,
    inwardDate,
    vendorId,
    invoiceNo = null,
    inwardType = 'Fabric', // 'Fabric', 'Accessory', 'Jobwork'
    vendorFabName,
    vendorColor,
    noOfBundles = 1,
    uom = 'Kg',
    invoiceQty,
    inwardPhysicalQty,
    rate = null,
    remarks = null,
    createdBy = 'usr-dilip',
    defaultGsm = null,
    defaultWidth = null,
    bundles = [] // optional specific weights/bins for each roll
  }) {
    if (!parentCode || !vendorId || !vendorFabName || !vendorColor || !invoiceQty || !inwardPhysicalQty) {
      throw new Error('parentCode, vendorId, vendorFabName, vendorColor, invoiceQty, and inwardPhysicalQty are required');
    }

    const cleanParentCode = parentCode.trim().toUpperCase();
    const invQty = parseFloat(invoiceQty);
    const physQty = parseFloat(inwardPhysicalQty);
    const shortfall = round(invQty - physQty, 3);
    const bundleCount = parseInt(noOfBundles, 10) || 1;

    return db.transaction(() => {
      // Check for duplicate parent code
      const existing = db.get('SELECT id FROM parent_inward_lots WHERE parent_code = ?', [cleanParentCode]);
      if (existing) {
        throw new Error(`Parent Lot Code '${cleanParentCode}' already exists in system`);
      }

      // Check vendor
      const vendor = db.get('SELECT * FROM entities WHERE id = ?', [vendorId]);
      if (!vendor) {
        throw new Error(`Vendor '${vendorId}' not found in entities`);
      }

      const parentLotId = `plt-${Date.now()}`;
      const effectiveDate = inwardDate || new Date().toISOString().slice(0, 10);

      db.run(`
        INSERT INTO parent_inward_lots (
          id, parent_code, inward_date, vendor_id, invoice_no, inward_type,
          vendor_fab_name, vendor_color, no_of_bundles, uom, invoice_qty,
          inward_physical_qty, shortfall_qty, rate, remarks, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        parentLotId, cleanParentCode, effectiveDate, vendorId, invoiceNo || null, inwardType,
        vendorFabName, vendorColor, bundleCount, uom, invQty,
        physQty, shortfall, rate ? parseFloat(rate) : null, remarks || null, createdBy
      ]);

      const createdBundles = [];

      if (inwardType === 'Fabric') {
        const avgBundleWeight = round(physQty / bundleCount, 3);

        for (let i = 1; i <= bundleCount; i++) {
          const seqStr = String(i).padStart(2, '0');
          const totalStr = String(bundleCount).padStart(2, '0');
          const bundleCode = `${cleanParentCode}-${seqStr}/${totalStr}`;
          const bundleId = `bnd-${Date.now()}-${i}`;

          const customBundle = bundles[i - 1] || {};
          const rollWeight = customBundle.weight ? parseFloat(customBundle.weight) : avgBundleWeight;
          const locationBin = customBundle.locationBin || `A-${seqStr}`;
          const gsm = customBundle.gsm || defaultGsm || 220;
          const width = customBundle.width || defaultWidth || '60"';

          const qrPayload = JSON.stringify({
            code: bundleCode,
            parent: cleanParentCode,
            fabric: vendorFabName,
            color: vendorColor,
            weightKg: rollWeight,
            gsm,
            bin: locationBin
          });

          db.run(`
            INSERT INTO fabric_bundles (
              id, bundle_code, parent_lot_id, parent_code, bundle_sequence, total_bundles,
              fabric_name, color_name, material_sub_type, bundle_gsm, bundle_width,
              original_qty, available_qty, issued_qty, location_bin, qc_status, qr_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Fabric', ?, ?, ?, ?, 0, ?, 'PASSED', ?)
          `, [
            bundleId, bundleCode, parentLotId, cleanParentCode, i, bundleCount,
            vendorFabName, vendorColor, gsm, width,
            rollWeight, rollWeight, locationBin, qrPayload
          ]);

          // Write to immutable stock ledger
          const ledgerId = `tx-${Date.now()}-${i}`;
          db.run(`
            INSERT INTO inventory_stock_ledger (
              id, txn_date, txn_type, parent_code, bundle_code, material_type,
              item_name, color_name, uom, qty_in, qty_out, balance_after,
              location_bin, performed_by, remarks
            ) VALUES (?, CURRENT_TIMESTAMP, 'INWARD', ?, ?, 'FABRIC', ?, ?, 'Kg', ?, 0, ?, ?, ?, ?)
          `, [
            ledgerId, cleanParentCode, bundleCode, vendorFabName, vendorColor,
            rollWeight, rollWeight, locationBin, createdBy, `Inward from vendor ${vendor.name} (${invoiceNo || 'No Inv'})`
          ]);

          createdBundles.push({ bundleCode, rollWeight, locationBin });
        }
      } else if (inwardType === 'Accessory') {
        const itemCode = `${cleanParentCode}-ACC`;
        const itemId = `acc-${Date.now()}`;
        const locationBin = remarks || 'BIN-ACC-01';

        db.run(`
          INSERT INTO accessory_items (
            id, item_code, parent_lot_id, parent_code, material_type,
            item_name, full_description, color_name, uom, original_qty,
            available_qty, issued_qty, location_bin
          ) VALUES (?, ?, ?, ?, 'Accessory', ?, ?, ?, ?, ?, ?, 0, ?)
        `, [
          itemId, itemCode, parentLotId, cleanParentCode,
          vendorFabName, `${vendorFabName} ${vendorColor}`, vendorColor, uom,
          physQty, physQty, locationBin
        ]);

        db.run(`
          INSERT INTO inventory_stock_ledger (
            id, txn_date, txn_type, parent_code, accessory_code, material_type,
            item_name, color_name, uom, qty_in, qty_out, balance_after,
            location_bin, performed_by, remarks
          ) VALUES (?, CURRENT_TIMESTAMP, 'INWARD', ?, ?, 'ACCESSORY', ?, ?, ?, ?, 0, ?, ?, ?, ?)
        `, [
          `tx-${Date.now()}`, cleanParentCode, itemCode, vendorFabName, vendorColor, uom,
          physQty, physQty, locationBin, createdBy, `Inward accessory from ${vendor.name}`
        ]);

        createdBundles.push({ itemCode, quantity: physQty, uom, locationBin });
      }

      db.audit(
        createdBy,
        createdBy,
        'INVENTORY',
        'INWARD_LOT',
        'parent_inward_lots',
        cleanParentCode,
        null,
        { parentCode: cleanParentCode, vendorName: vendor.name, qty: physQty, bundles: createdBundles.length },
        `Inwarded ${cleanParentCode}: ${physQty} ${uom} across ${bundleCount} unit(s)`
      );

      return {
        parentLotId,
        parentCode: cleanParentCode,
        inwardType,
        vendorName: vendor.name,
        invoiceQty: invQty,
        physicalQty: physQty,
        shortfallQty: shortfall,
        createdItemsCount: createdBundles.length,
        items: createdBundles
      };
    });
  },

  /**
   * Issue fabric roll or accessory to a production order with lot shade guard
   */
  issueMaterial({
    materialType = 'Fabric', // 'Fabric' or 'Accessory'
    itemCode, // bundle_code or accessory item_code
    productionOrderNo,
    qty,
    issuedBy = 'usr-dilip',
    remarks = null,
    userId = 'system'
  }) {
    if (!itemCode || !productionOrderNo || !qty || parseFloat(qty) <= 0) {
      throw new Error('itemCode, productionOrderNo, and positive qty are required');
    }

    const issueQty = parseFloat(qty);

    return db.transaction(() => {
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
      if (!order) {
        throw new Error(`Production Order '${productionOrderNo}' not found`);
      }

      if (materialType === 'Fabric') {
        const bundle = db.get('SELECT * FROM fabric_bundles WHERE bundle_code = ?', [itemCode.trim()]);
        if (!bundle) throw new Error(`Fabric roll '${itemCode}' not found`);

        if (bundle.available_qty < issueQty) {
          throw new Error(`Insufficient stock on roll ${itemCode}: Available ${bundle.available_qty} kg, requested ${issueQty} kg`);
        }

        // Lot shade verification
        if (bundle.color_name.toLowerCase() !== order.color_name.toLowerCase()) {
          console.warn(`[Inventory Warning] Issuing color '${bundle.color_name}' to order expecting '${order.color_name}'`);
        }

        const newAvailable = round(bundle.available_qty - issueQty, 3);
        const newIssued = round((bundle.issued_qty || 0) + issueQty, 3);

        db.run(`
          UPDATE fabric_bundles
          SET available_qty = ?, issued_qty = ?
          WHERE id = ?
        `, [newAvailable, newIssued, bundle.id]);

        db.run(`
          INSERT INTO inventory_stock_ledger (
            id, txn_date, txn_type, parent_code, bundle_code, production_order_no,
            material_type, item_name, color_name, uom, qty_in, qty_out,
            balance_after, location_bin, performed_by, remarks
          ) VALUES (?, CURRENT_TIMESTAMP, 'ISSUE_PRODUCTION', ?, ?, ?, 'FABRIC', ?, ?, 'Kg', 0, ?, ?, ?, ?, ?)
        `, [
          `tx-${Date.now()}`, bundle.parent_code, bundle.bundle_code, order.production_order_no,
          bundle.fabric_name, bundle.color_name, issueQty, newAvailable,
          bundle.location_bin, issuedBy, remarks || `Issued to ${order.production_order_no} for cutting`
        ]);

        db.audit(
          userId,
          issuedBy,
          'INVENTORY',
          'ISSUE_FABRIC',
          'fabric_bundles',
          bundle.bundle_code,
          { available: bundle.available_qty },
          { available: newAvailable, issuedQty: issueQty },
          `Issued ${issueQty} kg of ${bundle.bundle_code} to ${order.production_order_no}`
        );

        return {
          bundleCode: bundle.bundle_code,
          productionOrderNo: order.production_order_no,
          issuedQty: issueQty,
          remainingRollWeightKg: newAvailable
        };
      } else {
        const acc = db.get('SELECT * FROM accessory_items WHERE item_code = ?', [itemCode.trim()]);
        if (!acc) throw new Error(`Accessory item '${itemCode}' not found`);

        if (acc.available_qty < issueQty) {
          throw new Error(`Insufficient stock for accessory ${itemCode}: Available ${acc.available_qty}, requested ${issueQty}`);
        }

        const newAvailable = round(acc.available_qty - issueQty, 2);
        const newIssued = round((acc.issued_qty || 0) + issueQty, 2);

        db.run(`
          UPDATE accessory_items
          SET available_qty = ?, issued_qty = ?
          WHERE id = ?
        `, [newAvailable, newIssued, acc.id]);

        db.run(`
          INSERT INTO inventory_stock_ledger (
            id, txn_date, txn_type, parent_code, accessory_code, production_order_no,
            material_type, item_name, color_name, uom, qty_in, qty_out,
            balance_after, location_bin, performed_by, remarks
          ) VALUES (?, CURRENT_TIMESTAMP, 'ISSUE_PRODUCTION', ?, ?, ?, 'ACCESSORY', ?, ?, ?, 0, ?, ?, ?, ?, ?)
        `, [
          `tx-${Date.now()}`, acc.parent_code, acc.item_code, order.production_order_no,
          acc.item_name, acc.color_name, acc.uom, issueQty, newAvailable,
          acc.location_bin, issuedBy, remarks || `Issued to ${order.production_order_no}`
        ]);

        return {
          itemCode: acc.item_code,
          productionOrderNo: order.production_order_no,
          issuedQty: issueQty,
          remainingQty: newAvailable
        };
      }
    });
  },

  /**
   * Return leftover roll remnant back to warehouse
   */
  returnRemnantRoll({
    bundleCode,
    returnedWeightKg,
    productionOrderNo,
    returnedBy = 'usr-dilip',
    remarks = null,
    userId = 'system'
  }) {
    if (!bundleCode || !returnedWeightKg || parseFloat(returnedWeightKg) <= 0) {
      throw new Error('bundleCode and positive returnedWeightKg are required');
    }

    const returnWeight = parseFloat(returnedWeightKg);

    return db.transaction(() => {
      const bundle = db.get('SELECT * FROM fabric_bundles WHERE bundle_code = ?', [bundleCode.trim()]);
      if (!bundle) throw new Error(`Fabric roll '${bundleCode}' not found`);

      const newAvailable = round(bundle.available_qty + returnWeight, 3);

      db.run('UPDATE fabric_bundles SET available_qty = ? WHERE id = ?', [newAvailable, bundle.id]);

      db.run(`
        INSERT INTO inventory_stock_ledger (
          id, txn_date, txn_type, parent_code, bundle_code, production_order_no,
          material_type, item_name, color_name, uom, qty_in, qty_out,
          balance_after, location_bin, performed_by, remarks
        ) VALUES (?, CURRENT_TIMESTAMP, 'RETURN_PRODUCTION', ?, ?, ?, 'FABRIC', ?, ?, 'Kg', ?, 0, ?, ?, ?, ?)
      `, [
        `tx-${Date.now()}`, bundle.parent_code, bundle.bundle_code, productionOrderNo || null,
        bundle.fabric_name, bundle.color_name, returnWeight, newAvailable,
        bundle.location_bin, returnedBy, remarks || `Remnant check-in from ${productionOrderNo || 'Cutting Floor'}`
      ]);

      db.audit(
        userId,
        returnedBy,
        'INVENTORY',
        'RETURN_REMNANT',
        'fabric_bundles',
        bundle.bundle_code,
        { previousAvailable: bundle.available_qty },
        { newAvailable, returnedWeight: returnWeight },
        `Roll remnant ${bundle.bundle_code}: returned ${returnWeight} kg`
      );

      return {
        bundleCode: bundle.bundle_code,
        returnedWeightKg: returnWeight,
        newAvailableRollKg: newAvailable
      };
    });
  },

  /**
   * Get immutable stock ledger entries
   */
  getStockLedger({ limit = 50, offset = 0, txnType, code } = {}) {
    let sql = 'SELECT * FROM inventory_stock_ledger';
    const params = [];
    const conditions = [];

    if (txnType) {
      conditions.push('txn_type = ?');
      params.push(txnType);
    }
    if (code) {
      conditions.push('(bundle_code LIKE ? OR parent_code LIKE ? OR accessory_code LIKE ?)');
      params.push(`%${code}%`, `%${code}%`, `%${code}%`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY txn_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit, 10) || 50, parseInt(offset, 10) || 0);

    return db.query(sql, params);
  },

  /**
   * Dual UOM Calculator: Weight (kg) <-> Length (meters)
   * Formula: Weight (kg) = (Length (m) * Width (m) * GSM) / 1000
   * Length (m) = (Weight (kg) * 1000) / (Width (m) * GSM)
   */
  calculateDualUom({ lengthMeters, weightKg, widthInches = 60, gsm = 220 }) {
    const widthMeters = parseFloat(widthInches) * 0.0254;
    const g = parseFloat(gsm);

    if (weightKg !== undefined && weightKg !== null) {
      const wt = parseFloat(weightKg);
      const computedLengthMeters = round((wt * 1000) / (widthMeters * g), 2);
      return {
        inputWeightKg: wt,
        widthInches,
        gsm: g,
        computedLengthMeters,
        formula: 'Length (m) = (Weight (kg) * 1000) / (Width (m) * GSM)'
      };
    } else if (lengthMeters !== undefined && lengthMeters !== null) {
      const len = parseFloat(lengthMeters);
      const computedWeightKg = round((len * widthMeters * g) / 1000, 3);
      return {
        inputLengthMeters: len,
        widthInches,
        gsm: g,
        computedWeightKg,
        formula: 'Weight (kg) = (Length (m) * Width (m) * GSM) / 1000'
      };
    } else {
      throw new Error('Provide either weightKg or lengthMeters to compute Dual UOM');
    }
  }
};

module.exports = inventoryService;
