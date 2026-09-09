#!/usr/bin/env node
/**
 * tools/autostart.mjs — install/remove logon autostart for qwen-api
 *
 *   node tools/autostart.mjs install
 *   node tools/autostart.mjs remove
 *   node tools/autostart.mjs status
 *
 * Uses the per-user Startup folder (no administrator rights needed), unlike
 * schtasks /sc onlogon which requires elevation.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runLoop = path.join(root, 'run-loop.bat');

const startupDir = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  : path.join(os.homedir(), 'Startup');

const target = path.join(startupDir, 'qwen-api.vbs');

function vbsBody() {
  return [
    "' qwen-api autostart - launches the local proxy hidden at logon",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Run "cmd /c ""${runLoop}""", 0, False`,
    '',
  ].join('\r\n');
}

const action = (process.argv[2] || 'status').toLowerCase();

if (action === 'install') {
  if (!fs.existsSync(runLoop)) {
    console.log(`cannot install: ${runLoop} not found`);
    process.exit(1);
  }
  fs.mkdirSync(startupDir, { recursive: true });
  fs.writeFileSync(target, vbsBody(), 'ascii');
  console.log('autostart installed');
  console.log(`  file : ${target}`);
  console.log('  effect: qwen-api starts hidden at every logon');
  console.log('  remove: uninstall-autostart.bat');
} else if (action === 'remove') {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { force: true });
    console.log(`autostart removed (${target})`);
  } else {
    console.log('autostart was not installed');
  }
} else {
  console.log(`autostart: ${fs.existsSync(target) ? 'INSTALLED' : 'not installed'}`);
  console.log(`  file : ${target}`);
  console.log('  install: install-autostart.bat');
}
