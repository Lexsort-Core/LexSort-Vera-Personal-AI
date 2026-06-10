const fs = require('fs');
const path = require('path');
const os = require('os');

const LOCK_DIR = path.join(os.homedir(), '.lexsort');
const LOCK_FILE = path.join(LOCK_DIR, 'sovereign.lock');

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

function init() {
  // Ensure the directory exists
  if (!fs.existsSync(LOCK_DIR)) {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
  }

  if (fs.existsSync(LOCK_FILE)) {
    const data = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (isPidAlive(data.pid)) {
      console.log('Instance already running. Exiting.');
      process.exit(0);
    } else {
      fs.unlinkSync(LOCK_FILE);
    }
  }
  
  const lockData = { pid: process.pid, startedAt: new Date().toISOString(), version: "1.1.1" };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData));
  
  const cleanup = () => { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

module.exports = { init };
