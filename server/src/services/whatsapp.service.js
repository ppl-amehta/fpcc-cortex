const db = require('../db');
const { round } = require('../utils');

const whatsappService = {
  /**
   * Outbound WhatsApp Notification Dispatch & Audit Logger
   */
  sendNotification({
    phoneNumber,
    recipientName = 'Client/Vendor',
    messageType = 'GENERAL', // 'ORDER_CONFIRMATION', 'PO_DISPATCH', 'RUNNER_ALERT', 'SHIPMENT_DISPATCH', 'GENERAL'
    templateName = null,
    messageBody,
    relatedEntityType = null,
    relatedEntityId = null,
    status = 'DELIVERED'
  }) {
    if (!phoneNumber || !messageBody) {
      throw new Error('phoneNumber and messageBody are required');
    }

    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const logId = `wa-out-${Date.now()}`;

    db.run(`
      INSERT INTO whatsapp_logs (
        id, direction, phone_number, recipient_name, message_type,
        template_name, message_body, related_entity_type, related_entity_id, status
      ) VALUES (?, 'OUTBOUND', ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      logId, cleanPhone, recipientName, messageType,
      templateName, messageBody.trim(), relatedEntityType, relatedEntityId, status
    ]);

    return {
      logId,
      phoneNumber: cleanPhone,
      recipientName,
      messageType,
      status,
      simulatedDelivery: true
    };
  },

  /**
   * 2-way Interactive ChatOps Engine (Command Parser & Execution)
   */
  processChatOpsCommand({
    fromNumber = '919822233445',
    senderName = 'Worker/Client',
    messageText
  }) {
    if (!messageText || !messageText.trim()) {
      throw new Error('Message body cannot be empty');
    }

    const cleanFrom = fromNumber.replace(/[^0-9]/g, '');
    const inLogId = `wa-in-${Date.now()}`;

    // 1. Log inbound message
    db.run(`
      INSERT INTO whatsapp_logs (
        id, direction, phone_number, recipient_name, message_type,
        message_body, status
      ) VALUES (?, 'INBOUND', ?, ?, 'INTERACTIVE_COMMAND', ?, 'RECEIVED')
    `, [inLogId, cleanFrom, senderName, messageText.trim()]);

    const upperMsg = messageText.trim().toUpperCase();
    let replyText = '';
    let triggerAction = null;

    // A. STATUS <OrderNo>
    if (upperMsg.startsWith('STATUS')) {
      const parts = messageText.trim().split(/\s+/);
      const queryOrder = parts.length > 1 ? parts[1].trim() : 'FPCC-PO-26001';
      const order = db.get('SELECT * FROM production_orders WHERE production_order_no LIKE ?', [`%${queryOrder}%`]);

      if (order) {
        const cut = db.get('SELECT coalesce(sum(total_pcs_cut), 0) as total FROM cutting_jobs WHERE production_order_no = ?', [order.production_order_no]);
        const branded = db.get('SELECT coalesce(sum(qty_received), 0) as total FROM subcontractor_challans WHERE production_order_no = ?', [order.production_order_no]);
        const stitched = db.get("SELECT coalesce(sum(completed_qty), 0) as total FROM floor_process_logs WHERE production_order_no = ? AND process_name = 'Stitching'", [order.production_order_no]);
        const qc = db.get("SELECT coalesce(sum(completed_qty), 0) as total FROM floor_process_logs WHERE production_order_no = ? AND process_name = 'QC_Inspection'", [order.production_order_no]);
        const packed = db.get('SELECT coalesce(sum(total_pcs), 0) as total, count(*) as boxes FROM carton_packings WHERE production_order_no = ?', [order.production_order_no]);

        replyText = `📦 *FPCC LIVE ORDER PULSE: ${order.production_order_no}*\n` +
          `• Client: ${order.client_name}\n` +
          `• Item: ${order.product_name} (${order.color_name})\n` +
          `• Target Qty: ${order.total_qty} pcs\n` +
          `• Current Stage: *${order.status}*\n\n` +
          `*Floor Progress Funnel:*\n` +
          `✂️ Cut: ${cut.total} pcs\n` +
          `🎨 Branded: ${branded.total} pcs\n` +
          `🧵 Stitched: ${stitched.total} pcs\n` +
          `🔍 QC Passed: ${qc.total} pcs\n` +
          `📦 Packed: ${packed.total} pcs (${packed.boxes} boxes)\n\n` +
          `🗓️ Target Dispatch: ${order.target_etd}`;
        triggerAction = 'ORDER_STATUS_LOOKUP';
      } else {
        replyText = `❌ Order "${queryOrder}" not found in FPCC Cortex. Please check the order number.`;
      }
    }
    // B. RUNNER <TransitNo> PICKUP
    else if (upperMsg.startsWith('RUNNER') && upperMsg.includes('PICKUP')) {
      const parts = messageText.trim().split(/\s+/);
      const transitNo = parts[1].trim();
      const transit = db.get('SELECT * FROM material_transits WHERE transit_pass_no LIKE ?', [`%${transitNo}%`]);

      if (transit) {
        db.run("UPDATE material_transits SET transit_status = 'IN_TRANSIT', picked_up_at = CURRENT_TIMESTAMP WHERE id = ?", [transit.id]);
        replyText = `🏃‍♂️ *RUNNER PICKUP ACKNOWLEDGED!*\n` +
          `• Transit Pass: *${transit.transit_pass_no}*\n` +
          `• From: ${transit.source_station}\n` +
          `• To: ${transit.dest_station}\n` +
          `• Item: ${transit.item_type} (${transit.dispatched_qty} pcs)\n` +
          `• Status: *IN-TRANSIT (Clock Started)*`;
        triggerAction = 'RUNNER_PICKUP_TRIGGERED';
      } else {
        replyText = `❌ Transit pass "${transitNo}" not found.`;
      }
    }
    // C. RUNNER <TransitNo> ARRIVED <Qty>
    else if (upperMsg.startsWith('RUNNER') && (upperMsg.includes('ARRIVED') || upperMsg.includes('RECEIVED'))) {
      const parts = messageText.trim().split(/\s+/);
      const transitNo = parts[1].trim();
      const countIndex = parts.findIndex(p => p.toUpperCase() === 'ARRIVED' || p.toUpperCase() === 'RECEIVED') + 1;
      const count = countIndex < parts.length ? parseInt(parts[countIndex], 10) : null;

      const transit = db.get('SELECT * FROM material_transits WHERE transit_pass_no LIKE ?', [`%${transitNo}%`]);

      if (!transit) {
        replyText = `❌ Transit pass "${transitNo}" not found.`;
      } else if (count === null || isNaN(count)) {
        replyText = `⚠️ Please include the piece count received: e.g. RUNNER ${transitNo} ARRIVED 158`;
      } else {
        const variance = transit.dispatched_qty - count;
        const isDisc = variance !== 0;
        const status = isDisc ? 'DISCREPANCY_FLAGGED' : 'DELIVERED_VERIFIED';

        db.run(`
          UPDATE material_transits 
          SET received_qty = ?, received_at = CURRENT_TIMESTAMP,
              transit_status = ?, variance_qty = ?,
              discrepancy_reason = ?
          WHERE id = ?
        `, [count, status, variance, isDisc ? 'Handover discrepancy logged via WhatsApp ChatOps' : null, transit.id]);

        if (isDisc) {
          replyText = `🚨 *TRANSIT DISCREPANCY FLAGGED via WhatsApp!*\n` +
            `• Pass: ${transit.transit_pass_no}\n` +
            `• Dispatched: ${transit.dispatched_qty} pcs\n` +
            `• Physical Received: *${count} pcs*\n` +
            `• *VARIANCE: ${variance} pcs missing!*\n` +
            `Production Manager has been alerted.`;
        } else {
          replyText = `✅ *HANDOVER VERIFIED 100%!* (${transit.transit_pass_no})\n` +
            `• Received: ${count} pcs at ${transit.dest_station}\n` +
            `• Custody transferred successfully.`;
        }
        triggerAction = 'HANDOVER_VERIFIED_TRIGGERED';
      }
    }
    // D. STOCK <FabricName>
    else if (upperMsg.startsWith('STOCK')) {
      const parts = messageText.trim().split(/\s+/);
      const queryFab = parts.length > 1 ? parts.slice(1).join(' ').trim() : 'Pique';
      const rolls = db.query(
        'SELECT bundle_code, fabric_name, color_name, available_qty, location_bin FROM fabric_bundles WHERE fabric_name LIKE ? AND available_qty > 0 LIMIT 5',
        [`%${queryFab}%`]
      );
      const totalKg = db.get(
        'SELECT coalesce(sum(available_qty), 0) as total FROM fabric_bundles WHERE fabric_name LIKE ?',
        [`%${queryFab}%`]
      );

      if (rolls.length > 0) {
        const rollList = rolls.map(r => `  • ${r.bundle_code}: ${r.available_qty} kg (${r.color_name}) @ Bin ${r.location_bin}`).join('\n');
        replyText = `🧵 *FPCC WAREHOUSE STOCK for "${queryFab}":*\n` +
          `• Total Stock: *${totalKg.total.toFixed(3)} kg*\n` +
          `• Active Rolls:\n${rollList}`;
        triggerAction = 'STOCK_LOOKUP';
      } else {
        replyText = `❌ No unreserved rolls found in warehouse matching "${queryFab}".`;
      }
    }
    // E. INVOICE <OrderNo>
    else if (upperMsg.startsWith('INVOICE')) {
      const parts = messageText.trim().split(/\s+/);
      const queryOrder = parts.length > 1 ? parts[1].trim() : '';
      const inv = db.get(
        'SELECT * FROM invoices WHERE production_order_no LIKE ? OR invoice_no LIKE ?',
        [`%${queryOrder}%`, `%${queryOrder}%`]
      );

      if (inv) {
        replyText = `🧾 *FPCC INVOICE: ${inv.invoice_no}*\n` +
          `• Order: ${inv.production_order_no}\n` +
          `• Client: ${inv.client_name}\n` +
          `• Total Amount: ₹${inv.total_amount}\n` +
          `• Paid: ₹${inv.amount_paid}\n` +
          `• *Balance Due: ₹${inv.balance_due}*\n` +
          `• Status: *${inv.payment_status}*`;
        triggerAction = 'INVOICE_LOOKUP';
      } else {
        replyText = `❌ No invoice found for "${queryOrder}".`;
      }
    }
    // F. APPROVE PO <PoNo>
    else if (upperMsg.startsWith('APPROVE PO')) {
      const parts = messageText.trim().split(/\s+/);
      const poNo = parts.length > 2 ? parts[2].trim() : '';
      const po = db.get('SELECT * FROM purchase_orders WHERE purchase_order_no LIKE ?', [`%${poNo}%`]);

      if (po) {
        db.run("UPDATE purchase_orders SET status = 'Acknowledged' WHERE id = ?", [po.id]);
        replyText = `✅ *PURCHASE ORDER APPROVED via WhatsApp!*\n` +
          `• PO Number: *${po.purchase_order_no}*\n` +
          `• Vendor: ${po.vendor_name}\n` +
          `• Total Amount: ₹${po.total_amount}\n` +
          `• Status: ACKNOWLEDGED for Procurement`;
        triggerAction = 'PO_APPROVED';
      } else {
        replyText = `❌ Purchase order "${poNo}" not found.`;
      }
    }
    // G. HELP / DEFAULT MENU
    else {
      replyText = `👋 *Welcome to FPCC Cortex ChatOps Assistant!*\n\n` +
        `Send any of the following interactive commands:\n` +
        `• *STATUS <OrderNo>* (e.g. STATUS FPCC-PO-26001)\n` +
        `• *RUNNER <TransitPass> PICKUP*\n` +
        `• *RUNNER <TransitPass> ARRIVED <Qty>*\n` +
        `• *STOCK <FabricName>* (e.g. STOCK Cotton)\n` +
        `• *INVOICE <OrderNo>*\n` +
        `• *APPROVE PO <PoNo>*`;
      triggerAction = 'MENU_DISPLAY';
    }

    // 2. Log outbound automated reply
    const outLogId = `wa-reply-${Date.now()}`;
    db.run(`
      INSERT INTO whatsapp_logs (
        id, direction, phone_number, recipient_name, message_type,
        message_body, status, response_payload
      ) VALUES (?, 'OUTBOUND', ?, ?, 'INTERACTIVE_COMMAND', ?, 'DELIVERED', ?)
    `, [outLogId, cleanFrom, senderName, replyText, JSON.stringify({ triggerAction })]);

    return {
      inboundMessage: messageText,
      sender: senderName,
      triggerAction,
      replyText
    };
  },

  /**
   * Get WhatsApp Communication Logs
   */
  getLogs({ direction, limit = 50 } = {}) {
    let sql = 'SELECT * FROM whatsapp_logs';
    const params = [];
    if (direction) {
      sql += ' WHERE direction = ?';
      params.push(direction.trim());
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 50);

    return db.query(sql, params);
  }
};

module.exports = whatsappService;
