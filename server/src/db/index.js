const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(config.dbPath);
    // Industrial tuning for maximum concurrency & data safety
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA synchronous = NORMAL;');
    dbInstance.exec('PRAGMA busy_timeout = 5000;');
  }
  return dbInstance;
}

const db = {
  query(sql, params = []) {
    const stmt = getDb().prepare(sql);
    return stmt.all(...params);
  },

  get(sql, params = []) {
    const stmt = getDb().prepare(sql);
    return stmt.get(...params);
  },

  run(sql, params = []) {
    const stmt = getDb().prepare(sql);
    return stmt.run(...params);
  },

  exec(sql) {
    return getDb().exec(sql);
  },

  transaction(fn) {
    const database = getDb();
    database.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      const result = fn();
      database.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        database.exec('ROLLBACK;');
      } catch (rollbackErr) {
        console.error('Failed to rollback transaction:', rollbackErr);
      }
      throw err;
    }
  },

  audit(userId, userName, category, action, table, entityId, oldState = null, newState = null, remarks = null) {
    try {
      const auditId = `aud-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      getDb().prepare(`
        INSERT INTO audit_trail (
          id, user_id, user_name, event_category, action,
          entity_table, entity_id, old_state_json, new_state_json, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        auditId,
        userId || 'system',
        userName || 'System Auto',
        category,
        action,
        table,
        entityId,
        oldState ? JSON.stringify(oldState) : null,
        newState ? JSON.stringify(newState) : null,
        remarks || null
      );
    } catch (err) {
      console.error('Failed to write audit trail log:', err.message);
    }
  }
};

module.exports = db;
