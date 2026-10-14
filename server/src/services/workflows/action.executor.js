/**
 * FPCC Cortex: Modular Workflow Action Executor
 * Executes automated side-effects across WhatsApp, Debit Notes, Remakes, and Audit Trails.
 */

const { interpolate } = require('./template.engine');
const { getDb } = require('../../db');

class ActionExecutor {
  /**
   * Executes a single action step against the resolved graph context.
   *
   * @param {object} actionDef
   * @param {object} context
   * @param {boolean} dryRun
   * @returns {object} Action execution result
   */
  async executeAction(actionDef, context, dryRun = false) {
    const { type, params = {} } = actionDef;
    const db = getDb();
    const result = {
      type,
      dryRun,
      timestamp: new Date().toISOString()
    };

    switch (type) {
      case 'SEND_WHATSAPP': {
        const rawPhone = interpolate(params.phone || params.recipientPhone || '919822233445', context);
        const phone = rawPhone.replace(/[^0-9]/g, '') || '919822233445';
        const recipientName = interpolate(params.recipientName || 'Manager', context);
        const messageBody = interpolate(params.template || params.message || 'Notification from FPCC Cortex Workflow', context);
        const messageType = params.messageType || 'WORKFLOW_AUTOMATION';
        const relatedEntity = context.production_order_no ? 'Order' : (context.challan_no ? 'Challan' : 'System');
        const relatedId = context.production_order_no || context.challan_no || context.id || 'system';

        result.payload = { phone, recipientName, messageBody, messageType };

        if (!dryRun) {
          const msgId = `wa-wf-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          db.prepare(`
            INSERT INTO whatsapp_logs (
              id, direction, phone_number, recipient_name, message_type,
              template_name, message_body, related_entity_type, related_entity_id, status
            ) VALUES (?, 'OUTBOUND', ?, ?, ?, 'workflow_recipe', ?, ?, ?, 'DELIVERED')
          `).run(msgId, phone, recipientName, messageType, messageBody, relatedEntity, relatedId);

          result.status = 'DISPATCHED';
          result.whatsappMessageId = msgId;
        } else {
          result.status = 'SIMULATED';
        }
        break;
      }

      case 'CREATE_DEBIT_NOTE': {
        const vendorId = interpolate(params.vendorId || context.vendor_id || 'ent-tirupur', context);
        const vendorName = interpolate(params.vendorName || context.vendor_name || 'Vendor', context);
        const challanNo = interpolate(params.challanNo || context.challan_no || 'CH-AUTO', context);
        const orderNo = interpolate(params.productionOrderNo || context.production_order_no || 'FPCC-PO-AUTO', context);
        const rejectedQty = parseInt(interpolate(String(params.rejectedQty || context.rejection_qty || 10), context), 10) || 10;
        const panelCost = parseFloat(params.panelCostPerPc || 45.0);
        const totalDebit = Number((rejectedQty * panelCost).toFixed(2));
        const reason = interpolate(params.reason || context.rejection_reason || 'Subcontractor Defect / Rejection', context);

        const dnNo = `DN-${Date.now().toString().slice(-6)}`;
        result.payload = { dnNo, vendorId, vendorName, challanNo, orderNo, rejectedQty, totalDebit, reason };

        if (!dryRun) {
          const id = `dn-${Date.now()}`;
          db.prepare(`
            INSERT INTO debit_notes (
              id, debit_note_no, vendor_id, vendor_name, challan_no, production_order_no,
              rejected_qty, panel_cost_per_pc, total_debit_amount, reason, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Issued')
          `).run(id, dnNo, vendorId, vendorName, challanNo, orderNo, rejectedQty, panelCost, totalDebit, reason);

          result.status = 'CREATED';
          result.debitNoteNo = dnNo;
        } else {
          result.status = 'SIMULATED';
        }
        break;
      }

      case 'QUEUE_REMAKE_ORDER': {
        const orderNo = interpolate(params.productionOrderNo || context.production_order_no || 'FPCC-PO-AUTO', context);
        const incidentRef = interpolate(params.incidentRefNo || context.challan_no || context.transit_pass_no || 'INC-AUTO', context);
        const dyeLot = interpolate(params.parentDyeLotId || context.parent_code || context.bundle_parent_lot_parent_code || '160326-A', context);
        const fabricName = interpolate(params.fabricName || context.fabric_name || 'Sinker Cotton', context);
        const colorName = interpolate(params.colorName || context.color_name || 'Navy', context);
        const totalRemakePcs = parseInt(interpolate(String(params.totalPcs || context.rejection_qty || context.variance_qty || 10), context), 10) || 10;
        const estimatedFabricKg = Number((totalRemakePcs * 0.22).toFixed(3));
        const priority = params.priority || 'HIGH';

        const rmkNo = `RMK-${Date.now().toString().slice(-6)}`;
        result.payload = { rmkNo, orderNo, incidentRef, dyeLot, totalRemakePcs, estimatedFabricKg, priority };

        if (!dryRun) {
          const id = `rmk-${Date.now()}`;
          db.prepare(`
            INSERT INTO remake_work_orders (
              id, remake_order_no, production_order_no, source_incident, incident_ref_no,
              parent_dye_lot_id, fabric_name, color_name, size_breakdown_json,
              total_pcs_to_remake, estimated_fabric_kg, priority, status
            ) VALUES (?, ?, ?, 'Workflow_Automation', ?, ?, ?, ?, ?, ?, ?, ?, 'Queued')
          `).run(id, rmkNo, orderNo, incidentRef, dyeLot, fabricName, colorName, JSON.stringify({ ALL: totalRemakePcs }), totalRemakePcs, estimatedFabricKg, priority);

          result.status = 'QUEUED';
          result.remakeOrderNo = rmkNo;
        } else {
          result.status = 'SIMULATED';
        }
        break;
      }

      case 'UPDATE_ENTITY_STATUS': {
        const targetTable = params.tableName || 'production_orders';
        const keyColumn = params.keyColumn || 'production_order_no';
        const keyValue = interpolate(params.keyValue || context[keyColumn] || context.production_order_no, context);
        const statusColumn = params.statusColumn || 'status';
        const newStatus = interpolate(params.newStatus || 'Investigation_Required', context);

        result.payload = { targetTable, keyColumn, keyValue, statusColumn, newStatus };

        if (!dryRun) {
          db.prepare(`UPDATE ${targetTable} SET ${statusColumn} = ? WHERE ${keyColumn} = ?`).run(newStatus, keyValue);
          result.status = 'UPDATED';
        } else {
          result.status = 'SIMULATED';
        }
        break;
      }

      case 'LOG_AUDIT_ALERT': {
        const category = params.category || 'WORKFLOW';
        const action = params.action || 'AUTO_TRIGGER';
        const table = params.entityTable || 'workflow_rules';
        const entityId = interpolate(params.entityId || context.production_order_no || context.id || 'system', context);
        const remarks = interpolate(params.remarks || params.message || 'Workflow action executed', context);

        result.payload = { category, action, table, entityId, remarks };

        if (!dryRun) {
          const auditId = `aud-wf-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          db.prepare(`
            INSERT INTO audit_trail (
              id, user_id, user_name, event_category, action,
              entity_table, entity_id, remarks
            ) VALUES (?, 'system', 'Cortex Workflow Engine', ?, ?, ?, ?, ?)
          `).run(auditId, category, action, table, entityId, remarks);

          result.status = 'LOGGED';
        } else {
          result.status = 'SIMULATED';
        }
        break;
      }

      default:
        result.status = 'SKIPPED_UNKNOWN_TYPE';
    }

    return result;
  }
}

module.exports = new ActionExecutor();
