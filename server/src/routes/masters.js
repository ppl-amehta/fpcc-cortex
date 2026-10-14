const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all master dropdowns in one single fast call
router.get('/all', (req, res) => {
  try {
    const users = db.query('SELECT id, user_name, email, role, can_inward, can_issue, can_return FROM users WHERE active = 1 ORDER BY user_name');
    const vendors = db.query("SELECT id, name, entity_type, contact_person, phone, gstin FROM entities WHERE entity_type IN ('vendor', 'both') ORDER BY name");
    const clients = db.query("SELECT id, name, entity_type, contact_person, phone, gstin FROM entities WHERE entity_type IN ('client', 'both') ORDER BY name");
    const fabrics = db.query('SELECT id, fpcc_fab_name, generic_name, default_gsm, default_width FROM fabric_catalog ORDER BY fpcc_fab_name');
    const colors = db.query('SELECT id, color_name, hex_code FROM colors ORDER BY color_name');
    const orders = db.query('SELECT id, production_order_no, sales_order_no, client_name, product_name, color_name, total_qty, status FROM production_orders ORDER BY production_order_no DESC');

    res.json({
      success: true,
      data: { users, vendors, clients, fabrics, colors, orders }
    });
  } catch (err) {
    console.error('Error fetching masters:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST to add new fabric on the fly
router.post('/fabrics', (req, res) => {
  try {
    const { fpccFabName, genericName, defaultGsm, defaultWidth } = req.body;
    if (!fpccFabName) {
      return res.status(400).json({ success: false, error: 'Fabric name required' });
    }
    const id = `fab-${Date.now()}`;
    db.run(
      'INSERT INTO fabric_catalog (id, fpcc_fab_name, generic_name, default_gsm, default_width) VALUES (?, ?, ?, ?, ?)',
      [id, fpccFabName.trim(), genericName || null, defaultGsm || null, defaultWidth || null]
    );
    res.json({ success: true, id, fpccFabName });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST to add new color on the fly
router.post('/colors', (req, res) => {
  try {
    const { colorName, hexCode } = req.body;
    if (!colorName) {
      return res.status(400).json({ success: false, error: 'Color name required' });
    }
    const id = `col-${Date.now()}`;
    db.run(
      'INSERT INTO colors (id, color_name, hex_code) VALUES (?, ?, ?)',
      [id, colorName.trim(), hexCode || '#4B5563']
    );
    res.json({ success: true, id, colorName });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST to add new vendor / client
router.post('/entities', (req, res) => {
  try {
    const { name, entityType, contactPerson, phone, email, gstin, address } = req.body;
    if (!name || !entityType) {
      return res.status(400).json({ success: false, error: 'Name and entity type required' });
    }
    const id = `ent-${Date.now()}`;
    db.run(
      'INSERT INTO entities (id, name, entity_type, contact_person, phone, email, gstin, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, name.trim(), entityType, contactPerson || null, phone || null, email || null, gstin || null, address || null]
    );
    res.json({ success: true, id, name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
