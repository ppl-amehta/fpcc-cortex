const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.resolve(__dirname, '../../data/fpcc_cortex.db');

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    dbInstance.exec('PRAGMA journal_mode = WAL;');
  }
  return dbInstance;
}

module.exports = {
  getDb,
  query: (sql, params = []) => {
    const db = getDb();
    const stmt = db.prepare(sql);
    return stmt.all(...params);
  },
  get: (sql, params = []) => {
    const db = getDb();
    const stmt = db.prepare(sql);
    const results = stmt.all(...params);
    return results.length > 0 ? results[0] : null;
  },
  run: (sql, params = []) => {
    const db = getDb();
    const stmt = db.prepare(sql);
    return stmt.run(...params);
  },
  transaction: (fn) => {
    const db = getDb();
    db.exec('BEGIN TRANSACTION;');
    try {
      const result = fn();
      db.exec('COMMIT;');
      return result;
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }
};
