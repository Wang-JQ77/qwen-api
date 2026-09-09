#!/usr/bin/env node
/**
 * server.js — qwen-api standalone entry
 *
 *   npm start
 *   PORT=9300 API_KEY=my-key node src/server.js
 *
 * NOTE: console output stays ASCII on purpose — it must render correctly
 * in cmd.exe with any codepage (GBK included).
 */

import { config } from 'dotenv';
import { startServer } from './server-core.js';

config(); // load .env when present

// A stateless HTTP proxy must not die from a stray async error: log and keep serving.
process.on('uncaughtException', (e) => {
  console.error('[qwen-api] uncaughtException (service kept alive):', e?.stack || e);
});
process.on('unhandledRejection', (e) => {
  console.error('[qwen-api] unhandledRejection (service kept alive):', e?.stack || e);
});

let handle;
try {
  handle = startServer({});
} catch (e) {
  console.error('[qwen-api] failed to start:', e.message);
  process.exit(1);
}

handle.server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[qwen-api] port ${handle.port} is already in use. Change PORT in .env and retry.`);
  } else {
    console.error('[qwen-api] server error:', e.message);
  }
  process.exit(1);
});

const base = handle.getLocalBaseUrl();
const bar = '-'.repeat(64);
console.log('');
console.log(bar);
console.log('  qwen-api | QwenWorkCN credits -> OpenAI / Anthropic API');
console.log(bar);
console.log(`  Base URL : ${base}/v1`);
console.log(`  API Key  : ${handle.apiKey ?? '(auth disabled)'}`);
if (handle.apiKeySource === 'auto') {
  console.log(`             persisted : ${handle.apiKeyFile} (delete to rotate)`);
} else if (handle.apiKeySource === 'auto-ephemeral') {
  console.log('             NOTE: key file not writable - key changes on restart');
}
console.log(`  Models   : ${((handle.client.catalog || []).map(m => m.key).join(' | ')) || 'pro | flash | qwen3.8-max-preview'}`);
console.log(`  Health   : ${base}/health`);
console.log(bar);
console.log('  quick test:');
console.log(`    curl ${base}/v1/chat/completions ^`);
console.log(`      -H "Authorization: Bearer ${handle.apiKey ?? ''}" ^`);
console.log('      -H "Content-Type: application/json" ^');
console.log('      -d "{\\"model\\":\\"pro\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"hi\\"}]}"');
console.log(bar);
console.log('');

// identity + quota status (async, wait up to 15s)
(async () => {
  for (let i = 0; i < 15 && !handle.state.ready; i++) {
    await new Promise(r => setTimeout(r, 1000));
  }
  if (handle.state.identityReady) {
    console.log(`[qwen-api] identity ready: uid=${handle.state.uid}`);
    try {
      const acct = await handle.cred.fetchAccountContext();
      const q = acct?.ok ? (acct.data?.quota ?? acct.data?.data?.quota) : null;
      if (q) console.log(`[qwen-api] quota remaining: ${q.remaining}`);
      else if (acct?.error) console.log(`[qwen-api] quota query failed (inference unaffected): ${acct.error}`);
    } catch { /* ignore */ }
  } else {
    console.warn(`[qwen-api] identity NOT ready: ${handle.state.error || 'initializing'}`);
    console.warn('[qwen-api] log in to the QwenWorkCN desktop app once, or set QW_UID / QW_MACHINE_ID in .env, then restart');
  }
})();
