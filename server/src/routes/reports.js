/**
 * FPCC Cortex: Modular Reporting & Graph Analytics Controller
 * REST API exposing Rippling-style dynamic query builder and pre-built operational reports.
 */

const express = require('express');
const router = express.Router();
const reportingService = require('../services/reporting.service');
const { requireAuth } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../utils');

/**
 * GET /api/reports/schema
 * Returns the Semantic Graph Ontology (entities, fields, types, and edges)
 */
router.get('/schema', (req, res, next) => {
  try {
    const schema = reportingService.getSchema();
    return res.json(schema);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/audit
 * Verifies graph health and tests sample 1-hop, 2-hop, and 3-hop relational traversals
 */
router.get('/audit', (req, res, next) => {
  try {
    const audit = reportingService.auditGraphConnectivity();
    return res.json({
      success: true,
      audit
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/prebuilt
 * Lists catalog of prebuilt industrial & executive reports
 */
router.get('/prebuilt', (req, res, next) => {
  try {
    const reports = reportingService.listPrebuiltReports();
    return res.json({
      success: true,
      reports
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/prebuilt/:reportKey
 * Executes a prebuilt report with optional query parameters (limit, offset)
 */
router.get('/prebuilt/:reportKey', (req, res, next) => {
  try {
    const { reportKey } = req.params;
    const { limit, offset } = req.query;
    const overrides = {};
    if (limit) overrides.limit = parseInt(limit, 10);
    if (offset) overrides.offset = parseInt(offset, 10);

    const report = reportingService.runPrebuiltReport(reportKey, overrides);
    return res.json({
      success: true,
      ...report
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reports/query
 * Executes a dynamic report query across the unified entity graph
 */
router.post('/query', (req, res, next) => {
  try {
    const querySpec = req.body;
    const result = reportingService.executeQuery(querySpec);
    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
