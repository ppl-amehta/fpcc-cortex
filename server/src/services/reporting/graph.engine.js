/**
 * FPCC Cortex: Universal Graph Query & Reporting Engine
 * Dynamically resolves multi-hop relational paths across the enterprise entity graph,
 * compiles parameterized SQLite queries, and computes cross-entity analytics.
 */

const { ENTITIES } = require('./schema.registry');
const { getDb } = require('../../db');

class GraphReportingEngine {
  /**
   * Resolves a dotted field path (e.g. "bundle.parent_lot.vendor.name" or "cutting_jobs.total_pcs_cut")
   * into a SQL column expression and accumulates the required JOIN definitions.
   *
   * @param {string} baseEntityName
   * @param {string} fieldPath
   * @param {Map<string, object>} joinsRegistry
   * @returns {{ colExpr: string, alias: string, fieldDef: object, entityName: string }}
   */
  resolveField(baseEntityName, fieldPath, joinsRegistry) {
    const parts = fieldPath.split('.');
    const baseDef = ENTITIES[baseEntityName];
    if (!baseDef) {
      throw new Error(`Unknown base entity: "${baseEntityName}"`);
    }

    // Case 1: Simple field on base entity (e.g. "total_qty" or "orders.total_qty")
    if (parts.length === 1 || (parts.length === 2 && parts[0] === baseEntityName)) {
      const fieldName = parts.length === 1 ? parts[0] : parts[1];
      const fieldDef = baseDef.fields[fieldName];
      if (!fieldDef) {
        throw new Error(`Field "${fieldName}" not found on entity "${baseEntityName}"`);
      }
      return {
        colExpr: `base.${fieldName}`,
        alias: fieldName,
        fieldDef,
        entityName: baseEntityName
      };
    }

    // Case 2: Multi-hop traversal (e.g. "client.name", "bundle.parent_lot.vendor.name")
    // If the path starts with the baseEntityName, strip it:
    let segments = [...parts];
    if (segments[0] === baseEntityName) {
      segments.shift();
    }

    const targetFieldName = segments.pop(); // The actual field on the terminal entity
    let currentEntity = baseEntityName;
    let currentAlias = 'base';
    let pathPrefix = '';

    for (let i = 0; i < segments.length; i++) {
      const relName = segments[i];
      const currDef = ENTITIES[currentEntity];
      if (!currDef || !currDef.relationships || !currDef.relationships[relName]) {
        throw new Error(`Relationship "${relName}" does not exist on entity "${currentEntity}"`);
      }

      const rel = currDef.relationships[relName];
      pathPrefix = pathPrefix ? `${pathPrefix}__${relName}` : `j_${relName}`;
      const nextEntity = rel.targetEntity;
      const nextDef = ENTITIES[nextEntity];

      // Register the join if not already registered
      if (!joinsRegistry.has(pathPrefix)) {
        joinsRegistry.set(pathPrefix, {
          table: nextDef.tableName,
          alias: pathPrefix,
          sourceAlias: currentAlias,
          localKey: rel.localKey,
          targetKey: rel.targetKey,
          type: rel.type
        });
      }

      currentAlias = pathPrefix;
      currentEntity = nextEntity;
    }

    const terminalDef = ENTITIES[currentEntity];
    const fieldDef = terminalDef.fields[targetFieldName];
    if (!fieldDef) {
      throw new Error(`Field "${targetFieldName}" does not exist on terminal entity "${currentEntity}"`);
    }

    // Create a safe, unique column alias
    const safeAlias = parts.join('_').replace(/[^a-zA-Z0-9_]/g, '_');

    return {
      colExpr: `${currentAlias}.${targetFieldName}`,
      alias: safeAlias,
      fieldDef,
      entityName: currentEntity
    };
  }

  /**
   * Compiles the dynamic SQL query from a Rippling-style report specification.
   *
   * @param {object} spec
   * @returns {{ sql: string, params: any[], selectFields: object[] }}
   */
  compileQuery(spec) {
    const {
      baseEntity,
      fields = [],
      filters = [],
      groupBy = [],
      aggregations = [],
      orderBy = [],
      limit = 100,
      offset = 0
    } = spec;

    const baseDef = ENTITIES[baseEntity];
    if (!baseDef) {
      throw new Error(`Invalid baseEntity: "${baseEntity}". Supported: ${Object.keys(ENTITIES).join(', ')}`);
    }

    const joinsRegistry = new Map();
    const selectCols = [];
    const selectMeta = [];
    const params = [];

    // 1. Resolve direct SELECT fields (if not grouping, or if in group by)
    for (const f of fields) {
      const resolved = this.resolveField(baseEntity, f, joinsRegistry);
      selectCols.push(`${resolved.colExpr} AS "${resolved.alias}"`);
      selectMeta.push({
        field: f,
        alias: resolved.alias,
        displayName: resolved.fieldDef.displayName,
        type: resolved.fieldDef.type
      });
    }

    // 2. Resolve Aggregations (SUM, AVG, MIN, MAX, COUNT, COUNT_DISTINCT)
    for (const agg of aggregations) {
      const fn = (agg.function || 'COUNT').toUpperCase();
      const validFns = ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNT_DISTINCT'];
      if (!validFns.includes(fn)) {
        throw new Error(`Unsupported aggregation function "${fn}". Valid: ${validFns.join(', ')}`);
      }

      let aggExpr = '';
      let alias = agg.alias || `${fn.toLowerCase()}_${(agg.field || 'all').replace(/[^a-zA-Z0-9_]/g, '_')}`;

      if (fn === 'COUNT' && (!agg.field || agg.field === '*')) {
        aggExpr = 'COUNT(*)';
      } else if (fn === 'COUNT_DISTINCT') {
        const resolved = this.resolveField(baseEntity, agg.field, joinsRegistry);
        aggExpr = `COUNT(DISTINCT ${resolved.colExpr})`;
      } else {
        const resolved = this.resolveField(baseEntity, agg.field, joinsRegistry);
        aggExpr = `${fn}(${resolved.colExpr})`;
      }

      selectCols.push(`${aggExpr} AS "${alias}"`);
      selectMeta.push({
        field: agg.field || '*',
        alias,
        displayName: agg.displayName || alias,
        type: fn === 'AVG' ? 'number' : (fn === 'COUNT' || fn === 'COUNT_DISTINCT' ? 'number' : 'number'),
        isAggregation: true
      });
    }

    if (selectCols.length === 0) {
      // Default to business key or all fields on base
      selectCols.push('base.*');
    }

    // 3. Resolve Filters (WHERE clauses)
    const whereClauses = [];
    for (const flt of filters) {
      if (!flt.field) continue;
      const resolved = this.resolveField(baseEntity, flt.field, joinsRegistry);
      const op = (flt.operator || flt.op || '=').toLowerCase();

      switch (op) {
        case '=':
        case 'eq':
          whereClauses.push(`${resolved.colExpr} = ?`);
          params.push(flt.value);
          break;
        case '!=':
        case 'neq':
          whereClauses.push(`${resolved.colExpr} != ?`);
          params.push(flt.value);
          break;
        case '>':
        case 'gt':
          whereClauses.push(`${resolved.colExpr} > ?`);
          params.push(flt.value);
          break;
        case '>=':
        case 'gte':
          whereClauses.push(`${resolved.colExpr} >= ?`);
          params.push(flt.value);
          break;
        case '<':
        case 'lt':
          whereClauses.push(`${resolved.colExpr} < ?`);
          params.push(flt.value);
          break;
        case '<=':
        case 'lte':
          whereClauses.push(`${resolved.colExpr} <= ?`);
          params.push(flt.value);
          break;
        case 'like':
        case 'contains':
          whereClauses.push(`${resolved.colExpr} LIKE ?`);
          params.push(`%${flt.value}%`);
          break;
        case 'in':
          if (Array.isArray(flt.value) && flt.value.length > 0) {
            const placeholders = flt.value.map(() => '?').join(', ');
            whereClauses.push(`${resolved.colExpr} IN (${placeholders})`);
            params.push(...flt.value);
          }
          break;
        case 'is_null':
          whereClauses.push(`${resolved.colExpr} IS NULL`);
          break;
        case 'is_not_null':
          whereClauses.push(`${resolved.colExpr} IS NOT NULL`);
          break;
        default:
          whereClauses.push(`${resolved.colExpr} = ?`);
          params.push(flt.value);
      }
    }

    // 4. Resolve GROUP BY dimensions
    const groupByCols = [];
    for (const g of groupBy) {
      const resolved = this.resolveField(baseEntity, g, joinsRegistry);
      groupByCols.push(resolved.colExpr);
    }

    // 5. Resolve ORDER BY
    const orderByClauses = [];
    for (const ord of orderBy) {
      let colName = ord.field;
      const dir = (ord.direction || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

      // Check if it's an alias in selectMeta
      const matchingMeta = selectMeta.find(m => m.alias === colName || m.field === colName);
      if (matchingMeta) {
        orderByClauses.push(`"${matchingMeta.alias}" ${dir}`);
      } else {
        const resolved = this.resolveField(baseEntity, colName, joinsRegistry);
        orderByClauses.push(`${resolved.colExpr} ${dir}`);
      }
    }

    // 6. Build SQL Text
    let sql = `SELECT\n  ${selectCols.join(',\n  ')}\nFROM ${baseDef.tableName} base\n`;

    // Append LEFT JOINs in topological order
    for (const [joinAlias, j] of joinsRegistry.entries()) {
      sql += `LEFT JOIN ${j.table} ${joinAlias} ON ${j.sourceAlias}.${j.localKey} = ${joinAlias}.${j.targetKey}\n`;
    }

    if (whereClauses.length > 0) {
      sql += `WHERE ${whereClauses.join(' AND ')}\n`;
    }

    if (groupByCols.length > 0) {
      sql += `GROUP BY ${groupByCols.join(', ')}\n`;
    }

    if (orderByClauses.length > 0) {
      sql += `ORDER BY ${orderByClauses.join(', ')}\n`;
    }

    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 1000);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
    sql += `LIMIT ${safeLimit} OFFSET ${safeOffset};`;

    return { sql, params, selectMeta };
  }

  /**
   * Executes a dynamic graph report against the live database.
   *
   * @param {object} querySpec
   * @returns {{ data: any[], meta: object }}
   */
  execute(querySpec) {
    const startTime = Date.now();
    const db = getDb();

    const { sql, params, selectMeta } = this.compileQuery(querySpec);
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
    const duration = Date.now() - startTime;

    return {
      data: rows,
      meta: {
        baseEntity: querySpec.baseEntity,
        rowCount: rows.length,
        executionTimeMs: duration,
        columns: selectMeta,
        sql
      }
    };
  }
}

module.exports = new GraphReportingEngine();
