/**
 * FPCC Cortex: Workflow Template Interpolation Engine
 * Replaces {{dotted.field.path}} tokens with real-time graph data.
 */

function getValueByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let curr = obj;

  for (const part of parts) {
    if (curr === null || curr === undefined) return undefined;
    curr = curr[part];
  }

  return curr;
}

/**
 * Interpolates a string template with a graph context object.
 * Example: "Order {{orders.production_order_no}} for Client {{client.name}} has variance {{cutting_jobs.variance_pct}}%"
 */
function interpolate(template, context) {
  if (!template || typeof template !== 'string') return template;

  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, path) => {
    // 1. Try exact path match in context (e.g. "order.client.name")
    let val = getValueByPath(context, path);

    // 2. Try flattened alias match (e.g. "order_client_name" or "cutting_jobs_variance_pct")
    if (val === undefined) {
      const flatKey = path.replace(/\./g, '_');
      val = context[flatKey];
    }

    // 3. Try direct field name without entity prefix (e.g. "production_order_no")
    if (val === undefined && path.includes('.')) {
      const leaf = path.split('.').pop();
      val = context[leaf];
    }

    return val !== undefined && val !== null ? String(val) : '';
  });
}

/**
 * Extracts all {{tokens}} from a string or nested object
 */
function extractTokens(input, tokens = new Set()) {
  if (!input) return tokens;

  if (typeof input === 'string') {
    const matches = input.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g);
    for (const m of matches) {
      tokens.add(m[1]);
    }
  } else if (Array.isArray(input)) {
    for (const item of input) {
      extractTokens(item, tokens);
    }
  } else if (typeof input === 'object') {
    for (const val of Object.values(input)) {
      extractTokens(val, tokens);
    }
  }

  return tokens;
}

module.exports = {
  interpolate,
  extractTokens,
  getValueByPath
};
