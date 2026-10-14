/**
 * FPCC Cortex: Universal Graph-Aware Workflow Automation Engine
 * Coordinates triggers, multi-hop graph context resolution, condition evaluation,
 * and modular action execution across the entire manufacturing operations suite.
 */

const { getDb } = require('../../db');
const { ENTITIES } = require('../reporting/schema.registry');
const graphEngine = require('../reporting/graph.engine');
const { extractTokens } = require('./template.engine');
const { evaluateConditions } = require('./condition.evaluator');
const actionExecutor = require('./action.executor');
const { DEFAULT_WORKFLOW_RECIPES } = require('./recipes.seed');

class WorkflowService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initializes the workflow engine and seeds default industrial recipes if empty.
   */
  init() {
    if (this.initialized) return;
    const db = getDb();

    try {
      const countRow = db.prepare('SELECT COUNT(*) as count FROM workflow_rules').get();
      if (!countRow || countRow.count === 0) {
        const insertStmt = db.prepare(`
          INSERT INTO workflow_rules (
            id, name, category, description, enabled,
            trigger_entity, trigger_event, conditions_json, actions_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const recipe of DEFAULT_WORKFLOW_RECIPES) {
          insertStmt.run(
            recipe.id,
            recipe.name,
            recipe.category,
            recipe.description,
            recipe.enabled,
            recipe.trigger_entity,
            recipe.trigger_event,
            recipe.conditions_json,
            recipe.actions_json
          );
        }
        console.log(`[WorkflowService] Seeded ${DEFAULT_WORKFLOW_RECIPES.length} default industrial workflow recipes.`);
      }
    } catch (err) {
      console.error('[WorkflowService] Init error:', err.message);
    }

    this.initialized = true;
  }

  /**
   * Lists all workflow rules with execution statistics.
   */
  listRules() {
    this.init();
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        id, name, description, category, enabled,
        trigger_entity, trigger_event, conditions_json, actions_json,
        execution_count, last_triggered_at, created_at, updated_at
      FROM workflow_rules
      ORDER BY created_at DESC
    `).all();

    return rows.map(r => ({
      ...r,
      enabled: Boolean(r.enabled),
      conditions: JSON.parse(r.conditions_json || '{}'),
      actions: JSON.parse(r.actions_json || '[]')
    }));
  }

  /**
   * Retrieves a single workflow rule by ID.
   */
  getRule(id) {
    this.init();
    const db = getDb();
    const r = db.prepare('SELECT * FROM workflow_rules WHERE id = ?').get(id);
    if (!r) return null;

    return {
      ...r,
      enabled: Boolean(r.enabled),
      conditions: JSON.parse(r.conditions_json || '{}'),
      actions: JSON.parse(r.actions_json || '[]')
    };
  }

  /**
   * Registers a new custom workflow rule.
   */
  createRule(ruleData) {
    this.init();
    const db = getDb();
    const {
      name,
      description = '',
      category = 'Operations',
      enabled = true,
      trigger_entity,
      trigger_event = 'CREATE',
      conditions = {},
      actions = []
    } = ruleData;

    if (!name || !trigger_entity) {
      throw new Error('Workflow rule requires "name" and "trigger_entity".');
    }

    if (!ENTITIES[trigger_entity]) {
      throw new Error(`Invalid trigger_entity "${trigger_entity}". Must be one of: ${Object.keys(ENTITIES).join(', ')}`);
    }

    const id = ruleData.id || `wf-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const conditionsJson = typeof conditions === 'string' ? conditions : JSON.stringify(conditions);
    const actionsJson = typeof actions === 'string' ? actions : JSON.stringify(actions);

    db.prepare(`
      INSERT INTO workflow_rules (
        id, name, description, category, enabled,
        trigger_entity, trigger_event, conditions_json, actions_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, name, description, category, enabled ? 1 : 0,
      trigger_entity, trigger_event, conditionsJson, actionsJson
    );

    return this.getRule(id);
  }

  /**
   * Updates an existing workflow rule.
   */
  updateRule(id, updates) {
    this.init();
    const db = getDb();
    const existing = this.getRule(id);
    if (!existing) {
      throw new Error(`Workflow rule with id "${id}" not found.`);
    }

    const fieldsToUpdate = [];
    const values = [];

    if (updates.name !== undefined) {
      fieldsToUpdate.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fieldsToUpdate.push('description = ?');
      values.push(updates.description);
    }
    if (updates.enabled !== undefined) {
      fieldsToUpdate.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.conditions !== undefined) {
      fieldsToUpdate.push('conditions_json = ?');
      values.push(typeof updates.conditions === 'string' ? updates.conditions : JSON.stringify(updates.conditions));
    }
    if (updates.actions !== undefined) {
      fieldsToUpdate.push('actions_json = ?');
      values.push(typeof updates.actions === 'string' ? updates.actions : JSON.stringify(updates.actions));
    }

    fieldsToUpdate.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    db.prepare(`UPDATE workflow_rules SET ${fieldsToUpdate.join(', ')} WHERE id = ?`).run(...values);
    return this.getRule(id);
  }

  /**
   * Deletes a workflow rule.
   */
  deleteRule(id) {
    this.init();
    const db = getDb();
    db.prepare('DELETE FROM workflow_rules WHERE id = ?').run(id);
    return { success: true, id };
  }

  /**
   * Resolves the entire graph context for a trigger record by compiling a multi-hop query
   * containing all requested field paths across related entities.
   *
   * @param {string} baseEntity
   * @param {string} recordIdentifier
   * @param {string[]} requestedFields
   * @returns {object} The resolved graph context object
   */
  resolveGraphContext(baseEntity, recordIdentifier, requestedFields = []) {
    const baseDef = ENTITIES[baseEntity];
    if (!baseDef) throw new Error(`Unknown base entity "${baseEntity}"`);

    // Determine query filter key (business key like cut_job_no or primary key id)
    const filterKey = baseDef.businessKey || baseDef.primaryKey;

    // Filter out invalid/empty field paths
    const validFields = Array.from(new Set(
      requestedFields.filter(f => f && typeof f === 'string' && f.trim() !== '')
    ));

    // Execute query via Graph Reporting Engine
    const querySpec = {
      baseEntity,
      fields: validFields,
      filters: [
        { field: `${baseEntity}.${filterKey}`, operator: '=', value: recordIdentifier }
      ],
      limit: 1
    };

    const result = graphEngine.execute(querySpec);
    if (!result.data || result.data.length === 0) {
      // Fallback: Try with primary key if business key returned no rows
      if (filterKey !== baseDef.primaryKey) {
        querySpec.filters = [{ field: `${baseEntity}.${baseDef.primaryKey}`, operator: '=', value: recordIdentifier }];
        const fallbackRes = graphEngine.execute(querySpec);
        if (fallbackRes.data && fallbackRes.data.length > 0) {
          return fallbackRes.data[0];
        }
      }
      return null;
    }

    return result.data[0];
  }

  /**
   * Evaluates all enabled workflows for a given trigger entity and event.
   *
   * @param {string} triggerEntity
   * @param {string} triggerEvent
   * @param {string} recordIdentifier
   * @param {object} extraContext
   * @returns {Promise<Array<object>>} Results of rule evaluations
   */
  async evaluateTriggers(triggerEntity, triggerEvent, recordIdentifier, extraContext = {}) {
    this.init();
    const db = getDb();
    const startTime = Date.now();

    // 1. Fetch matching enabled rules
    const rules = db.prepare(`
      SELECT * FROM workflow_rules
      WHERE trigger_entity = ?
        AND enabled = 1
        AND (trigger_event = ? OR trigger_event = '*' OR ? = '*')
    `).all(triggerEntity, triggerEvent, triggerEvent);

    if (!rules || rules.length === 0) {
      return [];
    }

    const evaluationResults = [];

    for (const ruleRow of rules) {
      const rule = {
        ...ruleRow,
        conditions: JSON.parse(ruleRow.conditions_json || '{}'),
        actions: JSON.parse(ruleRow.actions_json || '[]')
      };

      const ruleStartTime = Date.now();

      // 2. Extract all graph field paths referenced in conditions and action templates
      const tokenSet = new Set();
      extractTokens(rule.conditions, tokenSet);
      extractTokens(rule.actions, tokenSet);

      // Collect condition fields directly
      const condList = Array.isArray(rule.conditions) ? rule.conditions : (rule.conditions.conditions || []);
      for (const c of condList) {
        if (c.field) tokenSet.add(c.field);
      }

      // Add default base entity fields if token set is small
      tokenSet.add(`${triggerEntity}.${ENTITIES[triggerEntity]?.businessKey || 'id'}`);

      // 3. Resolve the graph context across multi-hop relations
      let graphContext = {};
      try {
        graphContext = this.resolveGraphContext(triggerEntity, recordIdentifier, Array.from(tokenSet)) || {};
      } catch (graphErr) {
        console.warn(`[WorkflowService] Warning resolving graph context for ${triggerEntity} ${recordIdentifier}:`, graphErr.message);
      }

      // Merge extra explicit context provided by caller
      const mergedContext = {
        ...graphContext,
        ...extraContext,
        _triggerEntity: triggerEntity,
        _triggerEvent: triggerEvent,
        _recordId: recordIdentifier
      };

      // 4. Evaluate Conditions
      const conditionResult = evaluateConditions(rule.conditions, mergedContext);

      const logId = `wfl-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      let status = 'SKIPPED_CONDITIONS';
      const actionResults = [];
      let errorMessage = null;

      if (conditionResult.matched) {
        status = 'SUCCESS';
        try {
          // 5. Execute all action steps in sequence
          for (const actionDef of rule.actions) {
            const actRes = await actionExecutor.executeAction(actionDef, mergedContext, false);
            actionResults.push(actRes);
          }

          // Update rule execution count and last_triggered_at
          db.prepare(`
            UPDATE workflow_rules
            SET execution_count = execution_count + 1,
                last_triggered_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(rule.id);

        } catch (actErr) {
          status = 'FAILED';
          errorMessage = actErr.message;
          console.error(`[WorkflowService] Action execution failed for rule "${rule.name}":`, actErr);
        }
      }

      const elapsedMs = Date.now() - ruleStartTime;

      // 6. Record Execution Log
      try {
        db.prepare(`
          INSERT INTO workflow_execution_logs (
            id, rule_id, rule_name, trigger_entity, trigger_record_id,
            conditions_matched, status, actions_executed_json, error_message, execution_time_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          logId, rule.id, rule.name, triggerEntity, recordIdentifier,
          conditionResult.matched ? 1 : 0, status,
          JSON.stringify(actionResults), errorMessage, elapsedMs
        );
      } catch (logErr) {
        console.error('[WorkflowService] Failed to write execution log:', logErr.message);
      }

      evaluationResults.push({
        ruleId: rule.id,
        ruleName: rule.name,
        triggerEntity,
        triggerEvent,
        recordId: recordIdentifier,
        matched: conditionResult.matched,
        conditionDetails: conditionResult.details,
        status,
        actionsExecuted: actionResults,
        executionTimeMs: elapsedMs
      });
    }

    return evaluationResults;
  }

  /**
   * Tests / dry-runs a workflow against a specific entity record.
   * Resolves graph context, evaluates conditions, and renders action templates
   * WITHOUT executing actual mutations.
   */
  async testRule(ruleId, testRecordIdentifier) {
    this.init();
    const rule = this.getRule(ruleId);
    if (!rule) {
      throw new Error(`Workflow rule "${ruleId}" not found.`);
    }

    const tokenSet = new Set();
    extractTokens(rule.conditions, tokenSet);
    extractTokens(rule.actions, tokenSet);

    const condList = Array.isArray(rule.conditions) ? rule.conditions : (rule.conditions.conditions || []);
    for (const c of condList) {
      if (c.field) tokenSet.add(c.field);
    }

    const graphContext = this.resolveGraphContext(rule.trigger_entity, testRecordIdentifier, Array.from(tokenSet)) || {};
    const conditionResult = evaluateConditions(rule.conditions, graphContext);

    const simulatedActions = [];
    if (conditionResult.matched) {
      for (const actionDef of rule.actions) {
        const sim = await actionExecutor.executeAction(actionDef, graphContext, true);
        simulatedActions.push(sim);
      }
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      testRecordId: testRecordIdentifier,
      graphContext,
      matched: conditionResult.matched,
      conditionDetails: conditionResult.details,
      simulatedActions
    };
  }

  /**
   * Returns recent workflow execution logs.
   */
  getExecutionLogs(limit = 50) {
    this.init();
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM workflow_execution_logs
      ORDER BY executed_at DESC
      LIMIT ?
    `).all(limit);

    return rows.map(r => ({
      ...r,
      conditions_matched: Boolean(r.conditions_matched),
      actions_executed: JSON.parse(r.actions_executed_json || '[]')
    }));
  }
}

module.exports = new WorkflowService();
