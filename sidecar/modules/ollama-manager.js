const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');

const USER_DATA_DIR = path.join(os.homedir(), '.lexsort');
const BINARY_PATH = path.join(USER_DATA_DIR, 'bin', 'ollama');

function startOllama() {
  const env = {
    ...process.env,
    OLLAMA_HOST: '127.0.0.1:11434',
    OLLAMA_MODELS: path.join(USER_DATA_DIR, 'models'),
    OLLAMA_ORIGINS: 'http://127.0.0.1:58732'
  };

  const process = spawn(BINARY_PATH, ['serve'], { env, detached: false });
  process.stdout.on('data', (d) => console.log(`Ollama: ${d}`));
  return process;
}

function checkHealth(callback) {
  http.get('http://127.0.0.1:11434/api/tags', (res) => {
    callback(res.statusCode === 200);
  }).on('error', () => callback(false));
}

module.exports = { startOllama, checkHealth };
