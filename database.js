const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rsvps (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id),
    plus_one   INTEGER NOT NULL DEFAULT 0 CHECK (plus_one IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrate existing rsvps tables that pre-date the plus_one column.
// ALTER TABLE errors if the column already exists; that's fine — ignore it.
try {
  db.exec(`ALTER TABLE rsvps ADD COLUMN plus_one INTEGER NOT NULL DEFAULT 0 CHECK (plus_one IN (0, 1))`);
} catch { /* column already present */ }

module.exports = db;
