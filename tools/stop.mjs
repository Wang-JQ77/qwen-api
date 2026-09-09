#!/usr/bin/env node
/**
 * tools/stop.mjs — stop the qwen-api proxy (used by stop.bat)
 *
 * Strategy (deliberately avoids enumerating processes by command line — a
 * PowerShell helper doing that would match its own command line and could kill
 * the caller's shell):
 *   1. drop logs/stop.flag so run-loop.bat exits instead of restarting
 *   2. kill whatever listens on the configured port
 *   3. wait for the loop to observe the flag, then remove it
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const flag = path.join(root, 'logs', 'stop.flag');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function readPort() {
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);
    if (m) return Number(m[1]);
  }
  return Number(process.env.PORT || 9221);
}

function listeners(port) {
  const pids = new Set();
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5) continue;
      if (cols[1].endsWith(`:${port}`)) {
        const pid = cols[cols.length - 1];
        if (/^\d+$/.test(pid) && pid !== '0' && Number(pid) !== process.pid) pids.add(pid);
      }
    }
  } catch { /* netstat unavailable */ }
  return [...pids];
}

const port = readPort();

// 1. stand the auto-restart loop down
fs.mkdirSync(path.dirname(flag), { recursive: true });
fs.writeFileSync(flag, String(Date.now()));

// 2. kill the listener(s)
let killed = 0;
for (const pid of listeners(port)) {
  try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); killed++; } catch { /* already gone */ }
}

// 3. give run-loop.bat a moment to see the flag and exit, then clear it
await sleep(1500);
const still = listeners(port);
fs.rmSync(flag, { force: true });

if (still.length) {
  console.log(`could not stop pid(s) ${still.join(', ')} on port ${port} - try running as administrator`);
  process.exit(1);
}
console.log(killed ? `stopped qwen-api (${killed} process on port ${port})` : `qwen-api was not running on port ${port}`);
