/**
 * FPCC Cortex: Reporting & Graph Analytics Service
 * Facade providing semantic schema introspection, dynamic multi-hop query execution,
 * pre-built operational reports, and graph connectivity auditing.
 */

const { ENTITIES, getGraphSchemaOverview, findPath } = require('./reporting/schema.registry');
const graphEngine = require('./reporting/graph.engine');
const { PREBUILT_REPORTS } = require('./reporting/prebuilt.reports');
const { getDb } = require('../db');

class ReportingService {
  /**
   * Introspects the unified semantic graph and returns the full entity and edge metadata.
   */
  getSchema() {
    return {
      success: true,
      graph: getGraphSchemaOverview(),
      totalEntities: Object.keys(ENTITIES).length
    };
  }

  /**
   * Executes a custom Rippling-style report over the unified entity graph.
   *
   * @param {object} querySpec
   * @returns {object} Report results with data, columns metadata, and execution telemetry.
   */
  executeQuery(querySpec) {
    if (!querySpec || !querySpec.baseEntity) {
      throw new Error('Reporting query must provide a valid "baseEntity".');
    }
    return graphEngine.execute(querySpec);
  }

  /**
   * Lists all available pre-built industrial and executive reports.
   */
  listPrebuiltReports() {
    return Object.values(PREBUILT_REPORTS).map(rep => ({
      key: rep.key,
      title: rep.title,
      category: rep.category,
      description: rep.description,
      baseEntity: rep.query.baseEntity,
      fieldCount: rep.query.fields.length
    }));
  }

  /**
   * Executes a pre-built report with optional parameter overrides.
   *
   * @param {string} reportKey
   * @param {object} overrides
   */
  runPrebuiltReport(reportKey, overrides = {}) {
    const reportDef = PREBUILT_REPORTS[reportKey];
    if (!reportDef) {
      throw new Error(`Prebuilt report "${reportKey}" not found. Available: ${Object.keys(PREBUILT_REPORTS).join(', ')}`);
    }

    const mergedQuery = {
      ...reportDef.query,
      ...overrides,
      filters: [
        ...(reportDef.query.filters || []),
        ...(overrides.filters || [])
      ]
    };

    const result = graphEngine.execute(mergedQuery);
    return {
      reportKey: reportDef.key,
      title: reportDef.title,
      category: reportDef.category,
      description: reportDef.description,
      ...result
    };
  }

  /**
   * Audits the unified graph connectivity: verifies that every entity table exists,
   * inspects row counts, and tests sample relational traversals.
   */
  auditGraphConnectivity() {
    const db = getDb();
    const auditResults = {
      timestamp: new Date().toISOString(),
      entitiesCount: Object.keys(ENTITIES).length,
      entities: {},
      relationalTests: []
    };

    // 1. Audit each entity node
    for (const [key, ent] of Object.entries(ENTITIES)) {
      try {
        const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM ${ent.tableName}`).get();
        auditResults.entities[key] = {
          status: 'HEALTHY',
          tableName: ent.tableName,
          rowCount: countRow ? countRow.cnt : 0,
          declaredRelationships: Object.keys(ent.relationships).length
        };
      } catch (err) {
        auditResults.entities[key] = {
          status: 'ERROR',
          tableName: ent.tableName,
          error: err.message
        };
      }
    }

    // 2. Perform deep relational hop tests
    // Test 1: 1-hop (Order -> Client Entity)
    try {
      const q1 = graphEngine.execute({
        baseEntity: 'orders',
        fields: ['orders.production_order_no', 'client.name'],
        limit: 1
      });
      auditResults.relationalTests.push({
        test: '1-Hop: Order -> Client',
        success: true,
        rowsReturned: q1.data.length
      });
    } catch (e) {
      auditResults.relationalTests.push({
        test: '1-Hop: Order -> Client',
        success: false,
        error: e.message
      });
    }

    // Test 2: 2-hop (Cutting Job -> Roll -> Dye Lot)
    try {
      const q2 = graphEngine.execute({
        baseEntity: 'cutting_jobs',
        fields: ['cutting_jobs.cut_job_no', 'bundle.bundle_code', 'bundle.parent_lot.parent_code'],
        limit: 1
      });
      auditResults.relationalTests.push({
        test: '2-Hop: Cutting Lay -> Roll -> Dye Lot',
        success: true,
        rowsReturned: q2.data.length
      });
    } catch (e) {
      auditResults.relationalTests.push({
        test: '2-Hop: Cutting Lay -> Roll -> Dye Lot',
        success: false,
        error: e.message
      });
    }

    // Test 3: 3-hop (Cutting Job -> Roll -> Dye Lot -> Vendor Entity)
    try {
      const q3 = graphEngine.execute({
        baseEntity: 'cutting_jobs',
        fields: ['cutting_jobs.cut_job_no', 'bundle.parent_lot.vendor.name'],
        limit: 1
      });
      auditResults.relationalTests.push({
        test: '3-Hop: Cutting Lay -> Roll -> Dye Lot -> Mill Vendor',
        success: true,
        rowsReturned: q3.data.length
      });
    } catch (e) {
      auditResults.relationalTests.push({
        test: '3-Hop: Cutting Lay -> Roll -> Dye Lot -> Mill Vendor',
        success: false,
        error: e.message
      });
    }

    return auditResults;
  }
}

module.exports = new ReportingService();
