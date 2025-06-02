const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./users.db');

// Table for user API keys
db.run(`CREATE TABLE IF NOT EXISTS users (
  number TEXT PRIMARY KEY,
  apiKey TEXT
)`);

// Table for settings (like business number)
db.run(`CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
)`);

module.exports = db;