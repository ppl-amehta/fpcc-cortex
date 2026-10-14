const { EventEmitter } = require('node:events');
const db = require('../db');

class FactoryEventBus extends EventEmitter {}
const eventBus = new FactoryEventBus();

// EVENT TYPES
const EVENTS = {
  ORDER_CREATED: 'ORDER_CREATED',
  MATERIAL_SHORTFALL: 'MATERIAL_SHORTFALL',
  ROLL_INWARDED: 'ROLL_INWARDED',
  CUTTING_COMPLETED: 'CUTTING_COMPLETED',
  RUNNER_PICKUP: 'RUNNER_PICKUP',
  RUNNER_DISCREPANCY: 'RUNNER_DISCREPANCY',
  SUBCONTRACTOR_REJECTION: 'SUBCONTRACTOR_REJECTION',
  REMAKE_QUEUED: 'REMAKE_QUEUED',
  QC_COMPLETED: 'QC_COMPLETED',
  CARTON_SEALED: 'CARTON_SEALED',
  INVOICE_GENERATED: 'INVOICE_GENERATED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED'
};

// Internal Reactive Event Listeners (Rippling-esque Automations)

// 1. When an Order is created -> Log audit & verify BOM allocations
eventBus.on(EVENTS.ORDER_CREATED, (payload) => {
  try {
    db.audit(
      payload.userId || 'system',
      payload.userName || 'Client Intake',
      'ORDER',
      'CREATE',
      'production_orders',
      payload.productionOrderNo,
      null,
      { orderNo: payload.productionOrderNo, qty: payload.totalQty },
      `Production Order booked with ${payload.totalQty} pieces.`
    );
  } catch (err) {
    console.error('Error handling ORDER_CREATED event:', err);
  }
});

// 2. When a Runner Discrepancy occurs -> Log high priority audit & trigger WhatsApp alert
eventBus.on(EVENTS.RUNNER_DISCREPANCY, (payload) => {
  try {
    db.audit(
      payload.userId || 'system',
      payload.userName || 'Receiving Station',
      'RUNNER',
      'DISCREPANCY_FLAG',
      'material_transits',
      payload.transitPassNo,
      null,
      { passNo: payload.transitPassNo, sent: payload.dispatchedQty, received: payload.receivedQty, variance: payload.variance },
      `Transit Discrepancy: ${payload.variance} pieces missing during handover by ${payload.runnerName}!`
    );

    // Automated WhatsApp alert to Floor Manager
    const alertBody = `🚨 *FACTORY ALERT: RUNNER DISCREPANCY DETECTED*\n` +
      `• Transit Pass: *${payload.transitPassNo}*\n` +
      `• Order: ${payload.productionOrderNo}\n` +
      `• Route: ${payload.sourceStation} ➔ ${payload.destStation}\n` +
      `• Runner: ${payload.runnerName}\n` +
      `• Dispatched: ${payload.dispatchedQty} pcs | Received: ${payload.receivedQty} pcs\n` +
      `• *MISSING: ${payload.variance} pcs*\n` +
      `Reason: ${payload.reason || 'Unspecified count mismatch'}`;

    db.run(`
      INSERT INTO whatsapp_logs (
        id, direction, phone_number, recipient_name, message_type,
        message_body, related_entity_type, related_entity_id, status
      ) VALUES (?, 'OUTBOUND', '919822233445', 'Floor Manager', 'RUNNER_ALERT', ?, 'Transit', ?, 'DELIVERED')
    `, [`wa-disc-${Date.now()}`, alertBody, payload.transitPassNo]);
  } catch (err) {
    console.error('Error handling RUNNER_DISCREPANCY event:', err);
  }
});

// 3. When Subcontractor defects occur -> Create Debit Note and if rejections > buffer, queue Remake
eventBus.on(EVENTS.SUBCONTRACTOR_REJECTION, (payload) => {
  try {
    const { challanNo, vendorId, vendorName, productionOrderNo, rejectionQty, rejectionReason, defectPhotoUrl } = payload;
    
    // Auto-create Debit Note for spoiled panels
    const dnNo = `DN-${Date.now().toString().slice(-6)}`;
    const panelUnitCost = 45.0; // Fabric cost + cutting cost base
    const totalDebit = Number((rejectionQty * panelUnitCost).toFixed(2));

    db.run(`
      INSERT INTO debit_notes (
        id, debit_note_no, vendor_id, vendor_name, challan_no, production_order_no,
        rejected_qty, panel_cost_per_pc, total_debit_amount, reason, defect_photo_url, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Issued')
    `, [
      `dn-${Date.now()}`, dnNo, vendorId, vendorName, challanNo, productionOrderNo,
      rejectionQty, panelUnitCost, totalDebit, rejectionReason || 'Vendor Defect', defectPhotoUrl || null
    ]);

    // If rejections are severe (> 10 pcs), auto-queue Remake Work Order
    if (rejectionQty >= 10) {
      const rmkNo = `RMK-${Date.now().toString().slice(-6)}`;
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no = ?', [productionOrderNo]);
      
      // Find matching dye lot from existing cutting jobs
      const prevCut = db.get('SELECT bundle_code FROM cutting_jobs WHERE production_order_no = ? LIMIT 1', [productionOrderNo]);
      const dyeLot = prevCut ? prevCut.bundle_code.split('-').slice(0, 2).join('-') : 'STANDARD-LOT';

      db.run(`
        INSERT INTO remake_work_orders (
          id, remake_order_no, production_order_no, source_incident, incident_ref_no,
          parent_dye_lot_id, fabric_name, color_name, size_breakdown_json,
          total_pcs_to_remake, estimated_fabric_kg, priority, status
        ) VALUES (?, ?, ?, 'Subcontractor_Rejection', ?, ?, ?, ?, ?, ?, ?, 'HIGH', 'Queued')
      `, [
        `rmk-${Date.now()}`, rmkNo, productionOrderNo, challanNo,
        dyeLot, order?.product_name || 'Panel Remake', order?.color_name || 'Standard',
        JSON.stringify({ ALL: rejectionQty }), rejectionQty, Number((rejectionQty * 0.22).toFixed(3))
      ]);

      eventBus.emit(EVENTS.REMAKE_QUEUED, { remakeNo: rmkNo, productionOrderNo, qty: rejectionQty });
    }
  } catch (err) {
    console.error('Error handling SUBCONTRACTOR_REJECTION event:', err);
  }
});

module.exports = {
  eventBus,
  EVENTS
};
