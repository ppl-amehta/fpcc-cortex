/**
 * FPCC Cortex: Workflow Condition Evaluator
 * Evaluates conditions across the multi-hop entity graph.
 */

const { getValueByPath } = require('./template.engine');

function resolveContextValue(context, fieldPath) {
  // 1. Direct path lookup
  let val = getValueByPath(context, fieldPath);
  if (val !== undefined) return val;

  // 2. Flattened alias (e.g. "order_client_name")
  const flatKey = fieldPath.replace(/\./g, '_');
  if (context[flatKey] !== undefined) return context[flatKey];

  // 3. Leaf field name (e.g. "variance_pct")
  if (fieldPath.includes('.')) {
    const leaf = fieldPath.split('.').pop();
    if (context[leaf] !== undefined) return context[leaf];
  }

  return undefined;
}

function evaluateSingleCondition(cond, context) {
  const { field, op = 'eq', value } = cond;
  const actualVal = resolveContextValue(context, field);

  const normalizedOp = op.toLowerCase();

  switch (normalizedOp) {
    case 'eq':
    case '==':
    case '=':
      return actualVal == value;

    case 'neq':
    case '!=':
      return actualVal != value;

    case 'gt':
    case '>':
      return Number(actualVal) > Number(value);

    case 'gte':
    case '>=':
      return Number(actualVal) >= Number(value);

    case 'lt':
    case '<':
      return Number(actualVal) < Number(value);

    case 'lte':
    case '<=':
      return Number(actualVal) <= Number(value);

    case 'contains':
      if (actualVal === null || actualVal === undefined) return false;
      return String(actualVal).toLowerCase().includes(String(value).toLowerCase());

    case 'not_contains':
      if (actualVal === null || actualVal === undefined) return true;
      return !String(actualVal).toLowerCase().includes(String(value).toLowerCase());

    case 'starts_with':
      if (actualVal === null || actualVal === undefined) return false;
      return String(actualVal).toLowerCase().startsWith(String(value).toLowerCase());

    case 'ends_with':
      if (actualVal === null || actualVal === undefined) return false;
      return String(actualVal).toLowerCase().endsWith(String(value).toLowerCase());

    case 'in':
      if (Array.isArray(value)) {
        return value.some(v => v == actualVal);
      }
      return false;

    case 'not_in':
      if (Array.isArray(value)) {
        return !value.some(v => v == actualVal);
      }
      return true;

    case 'is_empty':
    case 'is_null':
      return actualVal === null || actualVal === undefined || actualVal === '' || (Array.isArray(actualVal) && actualVal.length === 0);

    case 'is_not_empty':
    case 'is_not_null':
      return actualVal !== null && actualVal !== undefined && actualVal !== '' && (!Array.isArray(actualVal) || actualVal.length > 0);

    default:
      return actualVal == value;
  }
}

/**
 * Evaluates a condition block against graph context.
 * @param {Array|object} conditions
 * @param {object} context
 * @returns {{ matched: boolean, details: Array<{ field, op, expected, actual, passed }> }}
 */
function evaluateConditions(conditions, context) {
  let condList = [];
  let matchType = 'ALL'; // Default: ALL conditions must match (AND)

  if (Array.isArray(conditions)) {
    condList = conditions;
  } else if (conditions && typeof conditions === 'object') {
    matchType = (conditions.matchType || 'ALL').toUpperCase();
    condList = conditions.rules || conditions.conditions || [];
  }

  if (condList.length === 0) {
    // If no conditions defined, trigger matches unconditionally
    return { matched: true, details: [] };
  }

  const details = [];
  let allPassed = true;
  let anyPassed = false;

  for (const cond of condList) {
    const passed = evaluateSingleCondition(cond, context);
    const actual = resolveContextValue(context, cond.field);

    details.push({
      field: cond.field,
      op: cond.op || 'eq',
      expected: cond.value,
      actual,
      passed
    });

    if (passed) anyPassed = true;
    if (!passed) allPassed = false;
  }

  const matched = matchType === 'ANY' ? anyPassed : allPassed;

  return {
    matched,
    details
  };
}

module.exports = {
  evaluateConditions,
  evaluateSingleCondition,
  resolveContextValue
};
