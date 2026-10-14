/**
 * FPCC Cortex: Graph-Aware Workflows & Modular Triggers Controller
 * REST API for creating, inspecting, testing, and managing Rippling-style automation recipes.
 */

const express = require('express');
const router = express.Router();
const workflowService = require('../services/workflows/workflow.service');
const { ENTITIES, getGraphSchemaOverview } = require('../services/reporting/schema.registry');
const { sendSuccess, sendError } = require('../utils');

/**
 * GET /api/workflows
 * Lists all active and inactive workflow rules
 */
router.get('/', (req, res, next) => {
  try {
    const rules = workflowService.listRules();
    return res.json({
      success: true,
      rules,
      count: rules.length
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/workflows/meta/triggers
 * Returns eligible entities and their triggerable fields from the semantic graph
 */
router.get('/meta/triggers', (req, res, next) => {
  try {
    const schema = getGraphSchemaOverview();
    const triggers = Object.entries(schema).map(([key, ent]) => ({
      entity: key,
      displayName: ent.displayName,
      description: ent.description,
      events: ['CREATE', 'UPDATE', 'STATUS_CHANGE', 'DELETE'],
      fields: ent.fields.map(f => ({
        name: f.name,
        path: `${key}.${f.name}`,
        displayName: f.displayName,
        type: f.type,
        options: f.options
      })),
      relationships: ent.relationships.map(r => ({
        name: r.name,
        targetEntity: r.targetEntity,
        displayName: r.displayName
      }))
    }));

    return res.json({
      success: true,
      triggers
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/workflows/meta/actions
 * Returns catalog of modular action types and parameter specifications
 */
router.get('/meta/actions', (req, res, next) => {
  try {
    const actions = [
      {
        type: 'SEND_WHATSAPP',
        displayName: 'Send WhatsApp Notification',
        description: 'Dispatches a templated WhatsApp message to a manager, client, or vendor using graph tokens.',
        parameters: {
          phone: { type: 'string', description: 'Recipient phone number or dynamic token e.g. {{client.phone}}', required: true },
          recipientName: { type: 'string', description: 'Recipient display name or token e.g. {{client.name}}', required: false },
          messageType: { type: 'string', description: 'Message category tag e.g. PALLA_ALERT, RUNNER_LOSS', required: false },
          template: { type: 'string', description: 'Message body supporting {{dotted.graph.path}} interpolation', required: true }
        }
      },
      {
        type: 'CREATE_DEBIT_NOTE',
        displayName: 'Auto-Generate Subcontractor Debit Note',
        description: 'Generates a financial debit note against a job-worker for damaged or spoiled panels.',
        parameters: {
          vendorId: { type: 'string', description: 'Vendor ID token e.g. {{vendor.id}}' },
          vendorName: { type: 'string', description: 'Vendor name token e.g. {{vendor.name}}' },
          challanNo: { type: 'string', description: 'Challan reference e.g. {{challans.challan_no}}' },
          productionOrderNo: { type: 'string', description: 'Order reference e.g. {{order.production_order_no}}' },
          rejectedQty: { type: 'number', description: 'Rejected pieces count or token e.g. {{challans.rejection_qty}}' },
          panelCostPerPc: { type: 'number', description: 'Per piece invested cost in INR (Default 45.0)' },
          reason: { type: 'string', description: 'Defect reason token or text' }
        }
      },
      {
        type: 'QUEUE_REMAKE_ORDER',
        displayName: 'Queue Remake Work Order',
        description: 'Queues a priority remake cut-slip to the cutting room with matching dye lot preservation.',
        parameters: {
          productionOrderNo: { type: 'string', description: 'Order number token e.g. {{order.production_order_no}}' },
          incidentRefNo: { type: 'string', description: 'Incident reference e.g. {{challans.challan_no}}' },
          totalPcs: { type: 'number', description: 'Quantity of pieces to remake' },
          priority: { type: 'string', enum: ['NORMAL', 'HIGH', 'CRITICAL'] }
        }
      },
      {
        type: 'UPDATE_ENTITY_STATUS',
        displayName: 'Update Record Status',
        description: 'Mutates a status field on the trigger entity or related production order.',
        parameters: {
          tableName: { type: 'string', description: 'Database table to update' },
          keyColumn: { type: 'string', description: 'Key column to match against' },
          keyValue: { type: 'string', description: 'Key value token e.g. {{production_order_no}}' },
          statusColumn: { type: 'string', description: 'Column to mutate (e.g. status)' },
          newStatus: { type: 'string', description: 'New status value' }
        }
      },
      {
        type: 'LOG_AUDIT_ALERT',
        displayName: 'Log High-Priority Audit Alert',
        description: 'Records an audit event in the compliance audit trail for managerial oversight.',
        parameters: {
          category: { type: 'string', description: 'Audit category e.g. CUTTING, RUNNER, FINANCE' },
          action: { type: 'string', description: 'Action tag' },
          remarks: { type: 'string', description: 'Remarks with dynamic graph tokens' }
        }
      }
    ];

    return res.json({
      success: true,
      actions
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/workflows/logs
 * Returns recent execution logs
 */
router.get('/logs', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const logs = workflowService.getExecutionLogs(limit);
    return res.json({
      success: true,
      logs,
      count: logs.length
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/workflows/:id
 * Retrieves rule by ID
 */
router.get('/:id', (req, res, next) => {
  try {
    const rule = workflowService.getRule(req.params.id);
    if (!rule) {
      return res.status(404).json({ success: false, error: 'Workflow rule not found' });
    }
    return res.json({ success: true, rule });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workflows
 * Creates a new custom workflow rule
 */
router.post('/', (req, res, next) => {
  try {
    const rule = workflowService.createRule(req.body);
    return res.status(201).json({
      success: true,
      rule
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/workflows/:id
 * Updates rule
 */
router.put('/:id', (req, res, next) => {
  try {
    const rule = workflowService.updateRule(req.params.id, req.body);
    return res.json({
      success: true,
      rule
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/workflows/:id
 * Deletes rule
 */
router.delete('/:id', (req, res, next) => {
  try {
    const result = workflowService.deleteRule(req.params.id);
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workflows/:id/test
 * Dry-run test of a workflow rule against a specific record identifier
 */
router.post('/:id/test', async (req, res, next) => {
  try {
    const { recordId } = req.body;
    if (!recordId) {
      return res.status(400).json({ success: false, error: 'Provide "recordId" in request body to test against.' });
    }

    const testResult = await workflowService.testRule(req.params.id, recordId);
    return res.json({
      success: true,
      ...testResult
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workflows/trigger
 * Manually evaluates workflows for a trigger event
 */
router.post('/trigger', async (req, res, next) => {
  try {
    const { entity, event = 'CREATE', recordId, extraContext = {} } = req.body;
    if (!entity || !recordId) {
      return res.status(400).json({ success: false, error: 'Provide "entity" and "recordId" in request body.' });
    }

    const results = await workflowService.evaluateTriggers(entity, event, recordId, extraContext);
    return res.json({
      success: true,
      evaluatedCount: results.length,
      results
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
