const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const db = new Database(path.join(os.homedir(), '.lexsort', 'conversations.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, created_at INTEGER);
  CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT);
`);

function saveConversation(id, title, messages) {
  const insertConv = db.prepare('INSERT INTO conversations VALUES (?, ?, ?)');
  insertConv.run(id, title, Date.now());
  const insertMsg = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?)');
  for (const m of messages) insertMsg.run(Math.random().toString(), id, m.role, m.content);
}

module.exports = { saveConversation, db };
