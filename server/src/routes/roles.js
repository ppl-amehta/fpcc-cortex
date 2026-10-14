/**
 * FPCC Cortex: Roles & Organizational Hierarchy Routes
 * Exposes role definitions, view privileges, and reporting tree.
 */

const express = require('express');
const router = express.Router();
const rolesService = require('../services/roles.service');

/**
 * GET /api/roles
 * Lists all defined organizational roles
 */
router.get('/', (req, res, next) => {
  try {
    const roles = rolesService.listRoles();
    res.json({
      success: true,
      count: roles.length,
      roles,
      data: roles
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/roles/hierarchy
 * Returns recursive tree of organizational roles with assigned staff
 */
router.get('/hierarchy', (req, res, next) => {
  try {
    const tree = rolesService.getHierarchyTree();
    const tiers = rolesService.getHierarchyTiers();
    res.json({
      success: true,
      tree,
      tiers
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/roles/:code
 * Retrieves single role definition
 */
router.get('/:code', (req, res, next) => {
  try {
    const role = rolesService.getRole(req.params.code);
    if (!role) {
      return res.status(404).json({ success: false, error: 'Role not found' });
    }
    res.json({
      success: true,
      role
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
