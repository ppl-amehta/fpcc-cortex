/**
 * FPCC Cortex: Out-of-the-Box Industrial Workflow Recipes
 * Demonstrates sophisticated cross-graph triggers, condition evaluations, and multi-action executions.
 */

const DEFAULT_WORKFLOW_RECIPES = [
  {
    id: 'wf-palla-variance-alert',
    name: 'High Fabric Lay Consumption Anomaly Escalation',
    category: 'Operations',
    description: 'Triggers when a cutting lay has actual palla consumption variance > 2% from standard BOM, sending WhatsApp alerts to Floor Managers with mill and cutter context.',
    enabled: 1,
    trigger_entity: 'cutting_jobs',
    trigger_event: 'CREATE',
    conditions_json: JSON.stringify({
      matchType: 'ALL',
      conditions: [
        { field: 'cutting_jobs.variance_pct', op: 'gt', value: 2.0 }
      ]
    }),
    actions_json: JSON.stringify([
      {
        type: 'SEND_WHATSAPP',
        params: {
          phone: '919822233445',
          recipientName: 'Cutting Floor Supervisor',
          messageType: 'PALLA_VARIANCE_ALERT',
          template: '🚨 *CORTEX ALERT: FABRIC YIELD ANOMALY*\n• Cut Job: *{{cutting_jobs.cut_job_no}}*\n• Order: {{order.production_order_no}} ({{order.client.name}})\n• Cutter: {{cutter.user_name}}\n• Roll: {{bundle.bundle_code}} (Lot: {{bundle.parent_lot.parent_code}})\n• Mill Vendor: {{bundle.parent_lot.vendor.name}}\n• Palla Avg: {{cutting_jobs.calculated_palla_avg_kg}} kg/pc\n• *Variance: {{cutting_jobs.variance_pct}}% above BOM*\nAction: Check marker layout & ply tension!'
        }
      },
      {
        type: 'LOG_AUDIT_ALERT',
        params: {
          category: 'CUTTING',
          action: 'YIELD_VARIANCE_TRIGGER',
          entityTable: 'cutting_jobs',
          entityId: '{{cutting_jobs.cut_job_no}}',
          remarks: 'Automatic escalation fired: Cut lay variance of {{cutting_jobs.variance_pct}}% logged for cutter {{cutter.user_name}}'
        }
      }
    ])
  },

  {
    id: 'wf-subcontractor-rejection-debit',
    name: 'Subcontractor Defect Auto-Debit & Remake Generator',
    category: 'Quality',
    description: 'Triggers upon receiving job-work panels with defect rejections. Auto-generates statutory Debit Note and dispatches WhatsApp alert.',
    enabled: 1,
    trigger_entity: 'challans',
    trigger_event: 'UPDATE',
    conditions_json: JSON.stringify({
      matchType: 'ALL',
      conditions: [
        { field: 'challans.rejection_qty', op: 'gt', value: 0 }
      ]
    }),
    actions_json: JSON.stringify([
      {
        type: 'CREATE_DEBIT_NOTE',
        params: {
          vendorId: '{{vendor.id}}',
          vendorName: '{{vendor.name}}',
          challanNo: '{{challans.challan_no}}',
          productionOrderNo: '{{order.production_order_no}}',
          rejectedQty: '{{challans.rejection_qty}}',
          panelCostPerPc: 45.0,
          reason: 'Defective panels: {{challans.rejection_reason}}'
        }
      },
      {
        type: 'SEND_WHATSAPP',
        params: {
          phone: '{{vendor.phone}}',
          recipientName: '{{vendor.name}}',
          messageType: 'VENDOR_DEBIT_ALERT',
          template: '⚠️ *DEBIT NOTE ISSUED: {{vendor.name}}*\n• Challan: *{{challans.challan_no}}*\n• Order: {{order.production_order_no}}\n• Process: {{challans.branding_type}} ({{challans.panel_name}})\n• Rejected Panels: *{{challans.rejection_qty}} pcs*\n• Reason: {{challans.rejection_reason}}\n• Total Debit: ₹{{challans.rejection_qty}} x ₹45.00\nA debit note has been deducted from your pending billing.'
        }
      },
      {
        type: 'QUEUE_REMAKE_ORDER',
        params: {
          productionOrderNo: '{{order.production_order_no}}',
          incidentRefNo: '{{challans.challan_no}}',
          totalPcs: '{{challans.rejection_qty}}',
          priority: 'CRITICAL'
        }
      }
    ])
  },

  {
    id: 'wf-runner-discrepancy-escalation',
    name: 'Runner Chain-of-Custody Loss Escalation',
    category: 'Logistics',
    description: 'Triggers when a runner physical handover is flagged with count discrepancies, immediately notifying Plant Security and Supervisor.',
    enabled: 1,
    trigger_entity: 'transits',
    trigger_event: 'STATUS_CHANGE',
    conditions_json: JSON.stringify({
      matchType: 'ALL',
      conditions: [
        { field: 'transits.transit_status', op: 'eq', value: 'DISCREPANCY_FLAGGED' },
        { field: 'transits.variance_qty', op: 'gte', value: 1 }
      ]
    }),
    actions_json: JSON.stringify([
      {
        type: 'SEND_WHATSAPP',
        params: {
          phone: '919822233445',
          recipientName: 'Plant Security & Logistics Head',
          messageType: 'RUNNER_LOSS_ALERT',
          template: '🚨 *CORTEX SECURITY ALERT: TRANSIT DISCREPANCY*\n• Transit Pass: *{{transits.transit_pass_no}}*\n• Route: {{transits.source_station}} ➔ {{transits.dest_station}}\n• Runner: *{{runner.user_name}}*\n• Order: {{order.production_order_no}} ({{order.client.name}})\n• Item: {{transits.item_type}}\n• Dispatched: {{transits.dispatched_qty}} pcs | Received: {{transits.received_qty}} pcs\n• *MISSING: {{transits.variance_qty}} pcs*\nReason: {{transits.discrepancy_reason}}'
        }
      },
      {
        type: 'LOG_AUDIT_ALERT',
        params: {
          category: 'RUNNER',
          action: 'DISCREPANCY_ESCALATION',
          entityTable: 'material_transits',
          entityId: '{{transits.transit_pass_no}}',
          remarks: 'Runner discrepancy escalation triggered for {{runner.user_name}}: {{transits.variance_qty}} pcs missing on route {{transits.source_station}}->{{transits.dest_station}}'
        }
      }
    ])
  },

  {
    id: 'wf-invoice-payment-reconciliation',
    name: 'Instant Payment Reconciliation & Client Receipt Dispatch',
    category: 'Finance',
    description: 'Triggers when an invoice balance is fully paid, sending automated payment receipt acknowledgment to the corporate client.',
    enabled: 1,
    trigger_entity: 'invoices',
    trigger_event: 'UPDATE',
    conditions_json: JSON.stringify({
      matchType: 'ALL',
      conditions: [
        { field: 'invoices.balance_due', op: 'lte', value: 0.0 }
      ]
    }),
    actions_json: JSON.stringify([
      {
        type: 'SEND_WHATSAPP',
        params: {
          phone: '{{client.phone}}',
          recipientName: '{{client.name}}',
          messageType: 'PAYMENT_RECEIPT',
          template: '✅ *PAYMENT RECEIVED & INVOICE SETTLED*\n• Client: *{{client.name}}*\n• Invoice: *{{invoices.invoice_no}}*\n• Order: {{order.production_order_no}}\n• Total Amount: ₹{{invoices.total_amount}}\n• Status: *PAID IN FULL*\nThank you for your business! Your tax invoice is marked settled.'
        }
      },
      {
        type: 'UPDATE_ENTITY_STATUS',
        params: {
          tableName: 'invoices',
          keyColumn: 'invoice_no',
          keyValue: '{{invoices.invoice_no}}',
          statusColumn: 'payment_status',
          newStatus: 'Paid'
        }
      }
    ])
  },

  {
    id: 'wf-vip-client-order-intake',
    name: 'Enterprise Bulk Order Fast-Track Notification',
    category: 'Operations',
    description: 'Triggers upon booking high-quantity orders (>= 300 pcs), notifying Production Director to reserve knitting capacity.',
    enabled: 1,
    trigger_entity: 'orders',
    trigger_event: 'CREATE',
    conditions_json: JSON.stringify({
      matchType: 'ALL',
      conditions: [
        { field: 'orders.total_qty', op: 'gte', value: 300 }
      ]
    }),
    actions_json: JSON.stringify([
      {
        type: 'SEND_WHATSAPP',
        params: {
          phone: '919822233445',
          recipientName: 'Production Director',
          messageType: 'VIP_ORDER_ALERT',
          template: '🎯 *VIP BULK ORDER BOOKED*\n• Order: *{{orders.production_order_no}}*\n• Client: *{{client.name}}*\n• Product: {{orders.product_name}} ({{orders.color_name}})\n• *Quantity: {{orders.total_qty}} pcs*\n• Target ETD: {{orders.target_etd}}\nCapacity reservation and priority BOM allocation initiated.'
        }
      },
      {
        type: 'LOG_AUDIT_ALERT',
        params: {
          category: 'ORDER',
          action: 'VIP_INTAKE_FLAG',
          entityTable: 'production_orders',
          entityId: '{{orders.production_order_no}}',
          remarks: 'VIP bulk order intake workflow triggered for {{client.name}}: {{orders.total_qty}} pcs'
        }
      }
    ])
  }
];

module.exports = {
  DEFAULT_WORKFLOW_RECIPES
};
