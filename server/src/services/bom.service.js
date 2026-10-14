const db = require('../db');
const { generateSequentialCode, round } = require('../utils');
const { eventBus, EVENTS } = require('./events.service');

const bomService = {
  // Get all BOM Templates
  getAllTemplates() {
    return db.query('SELECT * FROM product_bom_templates ORDER BY product_category, sub_category');
  },

  listTemplates() {
    return this.getAllTemplates();
  },

  getTemplate(category, subCategory) {
    if (subCategory) {
      return db.get(
        'SELECT * FROM product_bom_templates WHERE product_category = ? AND sub_category = ?',
        [category, subCategory]
      );
    }
    return db.get(
      'SELECT * FROM product_bom_templates WHERE product_category = ? OR sub_category = ? LIMIT 1',
      [category, category]
    );
  },

  upsertTemplate(data) {
    const {
      productCategory = 'Apparel',
      subCategory = 'Polo',
      productName,
      defaultFabricName = 'Matty Pique',
      defaultFabricConsumptionKg = 0.220,
      hasCollarCuff = 1,
      collarPiecesPerPc = 1,
      cuffPiecesPerPc = 2,
      buttonPiecesPerPc = 2,
      threadConesPer100Pcs = 0.8,
      labelPiecesPerPc = 2,
      polybagPerPc = 1,
      standardCuttingRate = 8.0,
      standardStitchingRate = 35.0,
      standardFinishingRate = 12.0,
      standardBrandingRate = 25.0,
      rejectionBufferPct = 5.0
    } = data;

    const existing = db.get(
      'SELECT id FROM product_bom_templates WHERE product_name = ?',
      [productName]
    );

    if (existing) {
      db.run(`
        UPDATE product_bom_templates SET
          product_category = ?, sub_category = ?, default_fabric_name = ?,
          default_fabric_consumption_kg = ?, has_collar_cuff = ?, collar_pieces_per_pc = ?,
          cuff_pieces_per_pc = ?, button_pieces_per_pc = ?, thread_cones_per_100_pcs = ?,
          label_pieces_per_pc = ?, polybag_per_pc = ?, standard_cutting_rate = ?,
          standard_stitching_rate = ?, standard_finishing_rate = ?, standard_branding_rate = ?,
          rejection_buffer_pct = ?
        WHERE id = ?
      `, [
        productCategory, subCategory, defaultFabricName,
        defaultFabricConsumptionKg, hasCollarCuff, collarPiecesPerPc,
        cuffPiecesPerPc, buttonPiecesPerPc, threadConesPer100Pcs,
        labelPiecesPerPc, polybagPerPc, standardCuttingRate,
        standardStitchingRate, standardFinishingRate, standardBrandingRate,
        rejectionBufferPct, existing.id
      ]);
      return { id: existing.id, productName, updated: true };
    } else {
      const id = `bom-${Date.now()}`;
      db.run(`
        INSERT INTO product_bom_templates (
          id, product_category, sub_category, product_name, default_fabric_name,
          default_fabric_consumption_kg, has_collar_cuff, collar_pieces_per_pc,
          cuff_pieces_per_pc, button_pieces_per_pc, thread_cones_per_100_pcs,
          label_pieces_per_pc, polybag_per_pc, standard_cutting_rate,
          standard_stitching_rate, standard_finishing_rate, standard_branding_rate,
          rejection_buffer_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id, productCategory, subCategory, productName, defaultFabricName,
        defaultFabricConsumptionKg, hasCollarCuff, collarPiecesPerPc,
        cuffPiecesPerPc, buttonPiecesPerPc, threadConesPer100Pcs,
        labelPiecesPerPc, polybagPerPc, standardCuttingRate,
        standardStitchingRate, standardFinishingRate, standardBrandingRate,
        rejectionBufferPct
      ]);
      return { id, productName, created: true };
    }
  },

  // Simulate BOM explosion without mutating database
  explodeBOM({ productCategory, subCategory, totalPieces, sizeMatrix, customSpecs = {} }) {
    let template = this.getTemplate(productCategory, subCategory);
    const totalPcs = parseInt(totalPieces, 10);
    const buffer = customSpecs.rejectionBufferPct || template?.rejection_buffer_pct || 5.0;
    const targetPcs = Math.ceil(totalPcs * (1 + (buffer / 100)));

    const fabAvg = customSpecs.fabricConsumption || template?.default_fabric_consumption_kg || 0.220;
    const fabricKg = round(targetPcs * fabAvg, 3);
    const collarPcs = (template?.has_collar_cuff || customSpecs.hasCollarCuff) ? targetPcs * (template?.collar_pieces_per_pc || 1) : 0;
    const cuffPcs = (template?.has_collar_cuff || customSpecs.hasCollarCuff) ? targetPcs * (template?.cuff_pieces_per_pc || 2) : 0;
    const buttonPcs = (template?.button_pieces_per_pc || 2) * targetPcs;
    const threadCones = round((targetPcs / 100) * (template?.thread_cones_per_100_pcs || 0.8), 1);
    const labelPcs = targetPcs * (template?.label_pieces_per_pc || 2);
    const polybagPcs = targetPcs * (template?.polybag_per_pc || 1);

    return {
      productCategory,
      subCategory,
      orderPieces: totalPcs,
      bufferedPieces: targetPcs,
      rejectionBufferPct: buffer,
      requirements: [
        { itemType: 'Fabric', name: template?.default_fabric_name || 'Matty Pique', qty: fabricKg, uom: 'kg' },
        ...(collarPcs > 0 ? [{ itemType: 'Collar', name: 'Matched Collar', qty: collarPcs, uom: 'pcs' }] : []),
        ...(cuffPcs > 0 ? [{ itemType: 'Cuff', name: 'Matched Rib Cuffs', qty: cuffPcs, uom: 'pcs' }] : []),
        { itemType: 'Button', name: 'Chalk Buttons', qty: buttonPcs, uom: 'pcs' },
        { itemType: 'Thread', name: 'Sewing Thread', qty: threadCones, uom: 'cones' },
        { itemType: 'Label', name: 'Neck & Care Labels', qty: labelPcs, uom: 'pcs' },
        { itemType: 'Polybag', name: 'PP Polybag', qty: polybagPcs, uom: 'pcs' }
      ]
    };
  },

  // Explode BOM for a Production Order
  explodeOrderBOM(productionOrderNo) {
    return db.transaction(() => {
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo.trim()]);
      if (!order) {
        throw new Error(`Production order '${productionOrderNo}' not found`);
      }

      // Check if template exists for exact product or fuzzy match
      let template = db.get('SELECT * FROM product_bom_templates WHERE product_name = ?', [order.product_name]);
      if (!template) {
        const lowerName = order.product_name.toLowerCase();
        let sub = 'Polo';
        if (lowerName.includes('hoodie')) sub = 'Hoodie';
        else if (lowerName.includes('round') || lowerName.includes('crew')) sub = 'Round_Neck';
        else if (lowerName.includes('jacket') || lowerName.includes('fleece')) sub = 'Jacket';
        else if (lowerName.includes('jogger') || lowerName.includes('track')) sub = 'Joggers';
        template = db.get('SELECT * FROM product_bom_templates WHERE sub_category = ? LIMIT 1', [sub]);
      }

      const totalPcs = order.total_qty;
      const bufferMultiplier = 1 + ((template?.rejection_buffer_pct || 5.0) / 100);
      const targetPcs = Math.ceil(totalPcs * bufferMultiplier);

      // Clean existing allocations for this order if re-exploding
      db.run('DELETE FROM order_bom_allocations WHERE production_order_no = ?', [order.production_order_no]);

      const allocations = [];

      // 1. Fabric Requirement
      const fabricName = template?.default_fabric_name || 'Poly Sinker';
      const fabAvg = template?.default_fabric_consumption_kg || 0.220;
      const fabricRequiredKg = round(targetPcs * fabAvg, 3);
      
      const fabricStock = db.get(
        'SELECT coalesce(sum(available_qty), 0) as total FROM fabric_bundles WHERE fabric_name = ? AND color_name = ?',
        [fabricName, order.color_name]
      );
      const availableKg = fabricStock?.total || 0;
      const allocatedFab = Math.min(fabricRequiredKg, availableKg);
      const shortfallFab = round(Math.max(0, fabricRequiredKg - allocatedFab), 3);

      const fabAllocId = `oba-${Date.now()}-fab`;
      db.run(`
        INSERT INTO order_bom_allocations (
          id, production_order_no, item_type, item_name, color_name,
          uom, required_qty, allocated_qty, shortfall_qty, status
        ) VALUES (?, ?, 'Fabric', ?, ?, 'kg', ?, ?, ?, ?)
      `, [
        fabAllocId, order.production_order_no, fabricName, order.color_name,
        fabricRequiredKg, allocatedFab, shortfallFab, shortfallFab > 0 ? 'Pending' : 'Allocated'
      ]);
      allocations.push({ itemType: 'Fabric', itemName: fabricName, uom: 'kg', required: fabricRequiredKg, allocated: allocatedFab, shortfall: shortfallFab });

      // 2. Collar & Cuff Requirement (if applicable)
      if (template?.has_collar_cuff) {
        const collarReq = totalPcs * (template.collar_pieces_per_pc || 1);
        const cuffReq = totalPcs * (template.cuff_pieces_per_pc || 2);

        const collarStock = db.get(
          'SELECT coalesce(sum(available_qty), 0) as total FROM accessory_items WHERE item_name LIKE ? AND color_name = ?',
          ['%Collar%', order.color_name]
        );
        const availCollar = collarStock?.total || 0;
        const allocCollar = Math.min(collarReq, availCollar);
        const shortfallCollar = Math.max(0, collarReq - allocCollar);

        db.run(`
          INSERT INTO order_bom_allocations (
            id, production_order_no, item_type, item_name, color_name,
            uom, required_qty, allocated_qty, shortfall_qty, status
          ) VALUES (?, ?, 'Collar', 'Matched Jacquard Collar', ?, 'pcs', ?, ?, ?, ?)
        `, [`oba-${Date.now()}-col`, order.production_order_no, order.color_name, collarReq, allocCollar, shortfallCollar, shortfallCollar > 0 ? 'Pending' : 'Allocated']);
        allocations.push({ itemType: 'Collar', itemName: 'Matched Jacquard Collar', uom: 'pcs', required: collarReq, allocated: allocCollar, shortfall: shortfallCollar });

        // Cuffs
        db.run(`
          INSERT INTO order_bom_allocations (
            id, production_order_no, item_type, item_name, color_name,
            uom, required_qty, allocated_qty, shortfall_qty, status
          ) VALUES (?, ?, 'Cuff', 'Matched Rib Cuffs', ?, 'pcs', ?, ?, ?, 'Allocated')
        `, [`oba-${Date.now()}-cuf`, order.production_order_no, order.color_name, cuffReq, cuffReq, 0]);
        allocations.push({ itemType: 'Cuff', itemName: 'Matched Rib Cuffs', uom: 'pcs', required: cuffReq, allocated: cuffReq, shortfall: 0 });
      }

      // 3. Buttons (if applicable)
      if (template && template.button_pieces_per_pc > 0) {
        const btnReq = totalPcs * template.button_pieces_per_pc;
        db.run(`
          INSERT INTO order_bom_allocations (
            id, production_order_no, item_type, item_name, color_name,
            uom, required_qty, allocated_qty, shortfall_qty, status
          ) VALUES (?, ?, 'Button', '18L 4-Hole Chalk Buttons', ?, 'pcs', ?, ?, 0, 'Allocated')
        `, [`oba-${Date.now()}-btn`, order.production_order_no, order.color_name, btnReq, btnReq]);
        allocations.push({ itemType: 'Button', itemName: 'Chalk Buttons', uom: 'pcs', required: btnReq, allocated: btnReq, shortfall: 0 });
      }

      // 4. Thread Cones
      const threadCones = round((totalPcs / 100) * (template?.thread_cones_per_100_pcs || 0.8), 1);
      db.run(`
        INSERT INTO order_bom_allocations (
          id, production_order_no, item_type, item_name, color_name,
          uom, required_qty, allocated_qty, shortfall_qty, status
        ) VALUES (?, ?, 'Thread', 'Spun Poly Sewing Thread (Vardhman)', ?, 'cones', ?, ?, 0, 'Allocated')
      `, [`oba-${Date.now()}-th`, order.production_order_no, order.color_name, threadCones, threadCones]);
      allocations.push({ itemType: 'Thread', itemName: 'Sewing Thread', uom: 'cones', required: threadCones, allocated: threadCones, shortfall: 0 });

      // 5. Labels & Polybags
      const labelReq = totalPcs * (template?.label_pieces_per_pc || 2);
      const polyReq = totalPcs * (template?.polybag_per_pc || 1);
      db.run(`
        INSERT INTO order_bom_allocations (
          id, production_order_no, item_type, item_name, color_name,
          uom, required_qty, allocated_qty, shortfall_qty, status
        ) VALUES (?, ?, 'Label', 'Woven Brand Neck Label + Wash Care', 'Standard', 'pcs', ?, ?, 0, 'Allocated')
      `, [`oba-${Date.now()}-lbl`, order.production_order_no, labelReq, labelReq]);
      allocations.push({ itemType: 'Label', itemName: 'Neck & Wash Care Labels', uom: 'pcs', required: labelReq, allocated: labelReq, shortfall: 0 });

      db.run(`
        INSERT INTO order_bom_allocations (
          id, production_order_no, item_type, item_name, color_name,
          uom, required_qty, allocated_qty, shortfall_qty, status
        ) VALUES (?, ?, 'Polybag', 'Self-Adhesive PP Polybag (10x14)', 'Clear', 'pcs', ?, ?, 0, 'Allocated')
      `, [`oba-${Date.now()}-poly`, order.production_order_no, polyReq, polyReq]);
      allocations.push({ itemType: 'Polybag', itemName: 'PP Polybag', uom: 'pcs', required: polyReq, allocated: polyReq, shortfall: 0 });

      // Check if any shortfalls exist
      const hasShortfall = allocations.some(a => a.shortfall > 0);
      if (hasShortfall) {
        eventBus.emit(EVENTS.MATERIAL_SHORTFALL, {
          productionOrderNo: order.production_order_no,
          allocations: allocations.filter(a => a.shortfall > 0)
        });
      }

      return {
        productionOrderNo: order.production_order_no,
        totalOrderPieces: totalPcs,
        bufferedTargetPieces: targetPcs,
        allocations,
        hasShortfall
      };
    });
  },

  // Allocate order BOM and optionally auto-generate Purchase Order for shortfalls
  allocateOrderBOM(productionOrderNo, { autoCreateShortfallPO = true, vendorId = null, userId = 'system' } = {}) {
    const explosion = this.explodeOrderBOM(productionOrderNo);
    let shortfallPurchaseOrderNo = null;

    if (autoCreateShortfallPO && explosion.hasShortfall) {
      const purchasingService = require('./purchasing.service');
      const shortfalls = explosion.allocations.filter(a => a.shortfall > 0);

      const lineItems = shortfalls.map(s => ({
        itemType: s.itemType,
        itemName: s.itemName,
        colorName: s.colorName || 'Default',
        orderedQty: s.shortfall,
        uom: s.uom,
        unitPrice: s.itemType === 'Fabric' ? 340.0 : (s.itemType === 'Collar' ? 22.0 : 15.0)
      }));

      // Find or default vendor
      const vendor = (vendorId ? db.get('SELECT * FROM entities WHERE id = ?', [vendorId]) : null)
        || db.get("SELECT * FROM entities WHERE entity_type IN ('vendor', 'supplier') LIMIT 1")
        || { id: 'ent-tirupur', name: 'Tirupur Knit Mills' };

      const po = purchasingService.createPurchaseOrder({
        vendorId: vendor.id,
        relatedProductionOrderNo: productionOrderNo,
        items: lineItems,
        notes: `Automated Sourcing PO for ${productionOrderNo} material shortfalls`,
        userId
      });

      shortfallPurchaseOrderNo = po.purchaseOrderNo;

      // Link PO back to order_bom_allocations
      db.run(
        'UPDATE order_bom_allocations SET purchase_order_no = ? WHERE production_order_no = ? AND shortfall_qty > 0',
        [shortfallPurchaseOrderNo, productionOrderNo]
      );
    }

    return {
      ...explosion,
      shortfallPurchaseOrderNo
    };
  },

  // Get order BOM allocations
  getOrderBOM(productionOrderNo) {
    return db.query('SELECT * FROM order_bom_allocations WHERE production_order_no = ? ORDER BY item_type', [productionOrderNo.trim()]);
  },

  getOrderAllocations(productionOrderNo) {
    return this.getOrderBOM(productionOrderNo);
  }
};

module.exports = bomService;
