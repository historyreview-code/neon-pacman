const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nickname TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS player_stats (
    user_id INTEGER PRIMARY KEY,
    rating INTEGER DEFAULT 1000,
    total_matches INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    top3 INTEGER DEFAULT 0,
    highest_rating INTEGER DEFAULT 1000,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    played_at TEXT DEFAULT (datetime('now')),
    duration_seconds INTEGER,
    match_log TEXT
  );

  CREATE TABLE IF NOT EXISTS match_players (
    match_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    rating_change INTEGER DEFAULT 0,
    PRIMARY KEY (match_id, user_id),
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Initialize stats for existing users without stats
db.exec(`
  INSERT OR IGNORE INTO player_stats (user_id, rating, total_matches, wins, top3, highest_rating)
  SELECT id, 1000, 0, 0, 0, 1000 FROM users;
`);

module.exports = db;
