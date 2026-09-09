#!/usr/bin/env node
/**
 * tools/status.mjs — print qwen-api service status (used by status.bat)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readPort() {
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);
    if (m) return Number(m[1]);
  }
  return Number(process.env.PORT || 9221);
}

function readKey() {
  const dataDir = process.env.QW_DATA_DIR || path.join(os.homedir(), '.qwen-api');
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'api-key.json'), 'utf8')).key;
  } catch {
    return process.env.API_KEY || null;
  }
}

const port = readPort();
const key = readKey();
const url = `http://127.0.0.1:${port}/health`;

try {
  const res = await fetch(url, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(10000),
  });
  const j = await res.json();
  if (!res.ok) {
    console.log(`status: HTTP ${res.status} - ${j?.error?.message || 'unauthorized'}`);
    process.exit(1);
  }
  console.log('status  : RUNNING');
  console.log(`base url: http://127.0.0.1:${port}/v1`);
  console.log(`api key : ${key ?? '(auth disabled)'}`);
  console.log(`account : ${j.uid || '-'}`);
  console.log(`models  : ${(j.models || []).join(', ')}`);
  console.log(`quota   : ${j.quota?.remaining ?? j.quotaError ?? 'n/a'}`);
} catch (e) {
  console.log('status  : NOT RUNNING');
  console.log(`reason  : ${e.message}`);
  console.log(`base url: http://127.0.0.1:${port}/v1 (expected)`);
  console.log('');
  console.log('start it:  double-click start.bat  (foreground, shows logs)');
  console.log('           double-click start-background.vbs  (hidden, auto-restart)');
  process.exit(1);
}
