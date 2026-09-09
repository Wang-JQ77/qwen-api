#!/usr/bin/env node
/**
 * setup.js — qwen-api first-run environment check
 *
 *   node setup.js          environment check + guidance
 *   node setup.js --test   additionally run one real inference smoke test
 *                          (consumes a tiny amount of quota)
 */

import fs from 'node:fs';
import path from 'node:path';
import * as qaw from './src/qoder-wasm.js';
import { resolveConfig, decryptAuthV2, readMachineId, CredentialManager } from './src/credentials.js';
import { QwenWorkClient } from './src/qwenwork-client.js';

const doLiveTest = process.argv.includes('--test');
const cfg = resolveConfig(process.env);

const ok = (s) => console.log('  [OK] ' + s);
const bad = (s) => console.log('  [X]  ' + s);
const warn = (s) => console.log('  [!]  ' + s);

console.log('');
console.log('qwen-api environment check');
console.log('-'.repeat(50));

// 1. Node version
const [major] = process.versions.node.split('.').map(Number);
if (major >= 18) ok(`Node.js v${process.versions.node}`);
else { bad(`Node.js v${process.versions.node} (need >= 18, upgrade at https://nodejs.org)`); process.exit(1); }

// 2. wasm
let wasmPath = cfg.wasmPath;
if (!wasmPath) {
  const bundled = path.join(process.cwd(), 'wasm', 'qoder_auth_wasm_bg.wasm');
  if (fs.existsSync(bundled)) wasmPath = bundled;
}
if (wasmPath && fs.existsSync(wasmPath)) {
  try {
    qaw.load(wasmPath);
    ok(`signing wasm: ${wasmPath}`);
  } catch (e) {
    bad(`signing wasm failed to load: ${e.message}`);
    process.exit(1);
  }
} else {
  bad('wasm/qoder_auth_wasm_bg.wasm not found (repo incomplete, re-download)');
  process.exit(1);
}

// 3. QwenWorkCN account identity
let uid = cfg.uid || null;
if (uid) {
  ok(`account uid: ${uid} (from QW_UID)`);
} else {
  const authPath = path.join(cfg.appData, 'auth-v2.dat');
  if (fs.existsSync(authPath)) {
    console.log(`  ..   decrypting ${authPath}`);
    const auth = await decryptAuthV2(cfg.appData);
    if (auth?.user?.id || auth?.user?.uid) {
      uid = auth.user.id || auth.user.uid;
      ok(`account uid: ${uid} (auto-decrypted, user ${auth.user.name || auth.user.username || '?'})`);
    } else {
      bad('auth-v2.dat decrypt failed (DPAPI). Make sure the QwenWorkCN desktop app is logged in on this machine.');
      console.log('       alternative: set QW_UID=<your uid> in .env');
    }
  } else {
    bad(`QwenWorkCN data dir not found: ${cfg.appData}`);
    console.log('       install + log in to the QwenWorkCN desktop app first: https://qwenwork.cn');
    console.log('       or set QW_UID and QW_MACHINE_ID manually in .env');
  }
}

// 4. machine-id
const machineId = readMachineId(cfg.cliHome, cfg.machineId);
if (cfg.machineId) ok(`machine-id: ${machineId} (from QW_MACHINE_ID)`);
else if (fs.existsSync(path.join(cfg.cliHome, 'machine-id'))) ok(`machine-id: ${machineId}`);
else warn(`no ${path.join(cfg.cliHome, 'machine-id')} - a random one will be used (set QW_MACHINE_ID if inference returns 403)`);

// 5. API key
const keyFile = path.join(cfg.dataDir, 'api-key.json');
if (process.env.API_KEY) {
  ok('API key: set via API_KEY env');
} else if (fs.existsSync(keyFile)) {
  try {
    const j = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    ok(`API key: ${j.key} (saved at ${keyFile})`);
  } catch { warn('API key file corrupt - a new key will be generated on next start'); }
} else {
  ok('API key: will be auto-generated and printed on `npm start`');
}

// 6. optional live test
if (doLiveTest) {
  console.log('');
  console.log('live inference smoke test (uses a tiny bit of quota)');
  console.log('-'.repeat(50));
  try {
    const cred = new CredentialManager(cfg, qaw);
    await cred.init();
    if (!cred.identity) throw new Error(cred.identityError?.message || 'no account identity');
    const client = new QwenWorkClient({
      gateway: cfg.gateway, wasmPath, identity: cred.identity, cliVersion: cfg.cliVersion,
    });
    await client.loadCatalog(cfg.cliHome, cred.uid);
    const modelKey = 'flash';
    const modelConfig = client.modelConfigForKey(modelKey);
    const res = await client.infer({
      modelKey: modelConfig.key,
      modelConfig,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: OK' }] }],
    });
    let content = '';
    await client.consumeSSE(res, {
      onChunk: (chunk) => { content += chunk?.choices?.[0]?.delta?.content ?? ''; },
    });
    if (content.trim()) {
      ok(`inference OK (${modelConfig.key}): "${content.trim().substring(0, 40)}"`);
      const acct = await cred.fetchAccountContext();
      const q = acct?.ok ? (acct.data?.quota ?? acct.data?.data?.quota) : null;
      if (q) ok(`quota remaining: ${q.remaining}`);
    } else {
      bad('inference returned empty - check `npm start` logs');
    }
  } catch (e) {
    bad(`inference failed: ${e.message}`);
  }
}

console.log('');
console.log('next step: npm start');
console.log('');
