/**
 * server-core.js — Express routes for the qwen-api proxy
 * (千问办公 QwenWorkCN → OpenAI / Anthropic compatible API)
 *
 * Routes:
 *   GET  /health                — status + quota snapshot
 *   GET  /v1/models             — OpenAI model list
 *   POST /v1/chat/completions   — OpenAI chat (stream + non-stream)
 *   POST /v1/messages           — Anthropic messages (stream + non-stream)
 *
 * API key policy (client → proxy auth):
 *   1. explicit apiKey option / API_KEY or QW_API_KEY env  → enforced as-is
 *   2. otherwise auto-generated "sk-qw-..." persisted to <dataDir>/api-key.json
 *      (delete the file to rotate; printed at every startup)
 *   3. QW_ALLOW_NO_KEY=1 disables auth entirely (local trusted use only)
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as qaw from './qoder-wasm.js';
import { resolveConfig, CredentialManager } from './credentials.js';
import { QwenWorkClient, normalizeModelKey, DEFAULT_MODELS } from './qwenwork-client.js';
import { openaiToQwenworkMessages, buildOpenAIResponse, buildOpenAIStreamChunk } from './openai-format.js';
import { anthropicToQwenworkMessages, buildAnthropicResponse, AnthropicStreamAdapter } from './anthropic-format.js';

function findBundledWasm() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, '..', 'wasm', 'qoder_auth_wasm_bg.wasm'),
    path.join(here, 'wasm', 'qoder_auth_wasm_bg.wasm'),
    path.join(process.cwd(), 'wasm', 'qoder_auth_wasm_bg.wasm'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function loadOrCreateApiKey(dataDir) {
  const file = path.join(dataDir, 'api-key.json');
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof j?.key === 'string' && j.key.length > 8) {
      return { key: j.key, persisted: true, file };
    }
  } catch { /* not present or corrupt */ }
  const key = 'sk-qw-' + crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ key, createdAt: new Date().toISOString() }, null, 2));
    return { key, persisted: true, file };
  } catch {
    // cannot persist (read-only home?) — ephemeral key, regenerated each start
    return { key, persisted: false, file };
  }
}

export function startServer(options = {}) {
  const cfg = {
    ...resolveConfig(process.env),
    ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)),
  };
  const port = Number(cfg.port || process.env.PORT || 9221);
  const host = cfg.host || process.env.HOST || '127.0.0.1';

  // ---- API key resolution ----
  const allowNoKey = /^(1|true)$/i.test(String(cfg.allowNoKey ?? process.env.QW_ALLOW_NO_KEY ?? ''));
  let apiKey = cfg.apiKey || process.env.API_KEY || process.env.QW_API_KEY || '';
  let apiKeySource = apiKey ? 'config' : null;
  let apiKeyFile = null;
  if (!apiKey && !allowNoKey) {
    const gen = loadOrCreateApiKey(cfg.dataDir);
    apiKey = gen.key;
    apiKeyFile = gen.file;
    apiKeySource = gen.persisted ? 'auto' : 'auto-ephemeral';
  }

  // ---- wasm + identity ----
  const wasmPath = cfg.wasmPath || findBundledWasm();
  if (!wasmPath) throw new Error('qoder_auth_wasm_bg.wasm not found (set QW_WASM_PATH)');
  qaw.load(wasmPath);

  const cred = new CredentialManager(cfg, qaw);
  const client = new QwenWorkClient({
    gateway: cfg.gateway,
    wasmPath,
    identity: null,
    cliVersion: cfg.cliVersion,
  });

  const state = {
    ready: false,          // wasm + catalog loaded
    identityReady: false,  // signing identity available
    uid: null,
    error: null,
  };

  (async () => {
    try {
      await cred.init();
      if (cred.identity) {
        client.setIdentity(cred.identity);
        state.uid = cred.identity.uid;
        state.identityReady = true;
      } else {
        state.error = cred.identityError?.message || 'no identity';
      }
      await client.loadCatalog(cfg.cliHome, cred.uid);
      state.ready = true;
    } catch (e) {
      state.error = e.message;
    }
  })();

  const app = express();
  app.use(express.json({ limit: '64mb' }));

  // ---- auth middleware ----
  app.use((req, res, next) => {
    if (allowNoKey || !apiKey) return next();
    const auth = req.headers['authorization'] || '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m && m[1] === apiKey) return next();
    // Anthropic-style header (Claude Code etc.)
    if (req.headers['x-api-key'] === apiKey) return next();
    res.status(401).json({
      error: {
        message: 'Invalid API key. Check the key printed by `npm start` (or ~/.qwen-api/api-key.json).',
        type: 'invalid_request_error',
      },
    });
  });

  const ensureIdentity = (res) => {
    if (state.identityReady) return true;
    res.status(503).json({
      error: {
        message:
          `QwenWorkCN account identity not available: ${state.error || 'initializing'}. ` +
          'Log in to the 千问办公 desktop app once (or set QW_UID / QW_MACHINE_ID in .env), then restart.',
        type: 'api_error',
      },
    });
    return false;
  };

  // ---- health ----
  app.get('/health', async (req, res) => {
    const out = {
      ok: state.identityReady,
      uid: state.uid,
      error: state.error,
      gateway: cfg.gateway,
      models: (client.catalog || DEFAULT_MODELS).map(m => m.key),
      auth: allowNoKey ? 'disabled' : 'api-key',
    };
    if (state.identityReady) {
      try {
        const acct = await cred.fetchAccountContext();
        const quota = acct?.ok ? (acct.data?.quota ?? acct.data?.data?.quota) : null;
        out.quota = quota ?? null;
        if (!acct.ok) out.quotaError = acct.error;
      } catch (e) { out.quotaError = e.message; }
    }
    res.json(out);
  });

  // ---- models ----
  app.get('/v1/models', (req, res) => {
    const models = (client.catalog || DEFAULT_MODELS).map(m => ({
      id: m.key,
      object: 'model',
      created: 0,
      owned_by: 'qwenwork',
    }));
    res.json({ object: 'list', data: models });
  });

  // ---- OpenAI chat completions ----
  app.post('/v1/chat/completions', async (req, res) => {
    if (!ensureIdentity(res)) return;
    const body = req.body || {};
    const stream = body.stream === true;
    const modelKey = normalizeModelKey(body.model, cfg.defaultModel);
    const messages = openaiToQwenworkMessages(body.messages || []);
    if (messages.length === 0) {
      return res.status(400).json({ error: { message: 'messages is required', type: 'invalid_request_error' } });
    }
    const modelConfig = client.modelConfigForKey(modelKey);
    const id = `chatcmpl-${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`;

    let upstream;
    try {
      upstream = await client.infer({ modelKey, modelConfig, messages });
    } catch (e) {
      return res.status(502).json({ error: { message: `upstream error: ${e.message}`, type: 'api_error' } });
    }

    if (!upstream.ok) {
      let detail = '';
      try {
        const text = await upstream.text();
        const m = text.match(/data:(\{.*\})/);
        detail = m ? (JSON.parse(m[1])?.body ?? text) : text;
      } catch { /* ignore */ }
      const status = upstream.status === 403 || upstream.status === 401 ? 403 : 502;
      return res.status(status).json({ error: { message: `qwenwork upstream ${upstream.status}: ${String(detail).substring(0, 500)}`, type: 'api_error' } });
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      let finishSent = false;
      const sendDone = () => {
        if (finishSent) return;
        finishSent = true;
        res.write('data: [DONE]\n\n');
        res.end();
      };
      req.on('close', () => { /* client gone */ });
      try {
        await client.consumeSSE(upstream, {
          onChunk: (chunk) => {
            const delta = chunk?.choices?.[0]?.delta;
            if (!delta) return;
            const outDelta = {};
            if (delta.content) outDelta.content = delta.content;
            if (delta.reasoning_content) outDelta.reasoning_content = delta.reasoning_content;
            if (delta.role) outDelta.role = delta.role;
            if (delta.finish_reason) outDelta.finish_reason = delta.finish_reason;
            if (Object.keys(outDelta).length === 0) return;
            const outChunk = buildOpenAIStreamChunk({ id, model: modelKey, delta: outDelta });
            res.write(`data: ${JSON.stringify(outChunk)}\n\n`);
          },
          onUsage: (usage) => {
            const outChunk = buildOpenAIStreamChunk({ id, model: modelKey, delta: {} });
            outChunk.usage = {
              prompt_tokens: usage?.prompt_tokens ?? 0,
              completion_tokens: usage?.completion_tokens ?? 0,
              total_tokens: usage?.total_tokens ?? 0,
            };
            res.write(`data: ${JSON.stringify(outChunk)}\n\n`);
          },
        });
        sendDone();
      } catch {
        if (!finishSent) sendDone();
      }
      return;
    }

    // non-stream: accumulate
    let content = '';
    let reasoning = '';
    let finishReason = 'stop';
    let usage = null;
    try {
      const r = await client.consumeSSE(upstream, {
        onChunk: (chunk) => {
          const c = chunk?.choices?.[0];
          if (!c) return;
          if (c.delta?.content) content += c.delta.content;
          if (c.delta?.reasoning_content) reasoning += c.delta.reasoning_content;
          if (c.finish_reason) finishReason = c.finish_reason;
        },
        onUsage: (u) => { usage = u; },
      });
      usage = usage || r.usage;
    } catch (e) {
      return res.status(502).json({ error: { message: `upstream stream error: ${e.message}`, type: 'api_error' } });
    }
    res.json(buildOpenAIResponse({ id, model: modelKey, content, reasoning, usage, finishReason }));
  });

  // ---- Anthropic messages ----
  app.post('/v1/messages', async (req, res) => {
    if (!ensureIdentity(res)) return;
    const body = req.body || {};
    const stream = body.stream === true;
    const modelKey = normalizeModelKey(body.model, cfg.defaultModel);
    const messages = anthropicToQwenworkMessages(body);
    if (messages.length === 0) {
      return res.status(400).json({ error: { type: 'invalid_request_error', message: 'messages is required' } });
    }
    const modelConfig = client.modelConfigForKey(modelKey);
    const id = `msg_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`;

    let upstream;
    try {
      upstream = await client.infer({ modelKey, modelConfig, messages });
    } catch (e) {
      return res.status(502).json({ error: { type: 'api_error', message: `upstream error: ${e.message}` } });
    }
    if (!upstream.ok) {
      let detail = '';
      try {
        const text = await upstream.text();
        const m = text.match(/data:(\{.*\})/);
        detail = m ? (JSON.parse(m[1])?.body ?? text) : text;
      } catch { /* ignore */ }
      return res.status(502).json({ error: { type: 'api_error', message: `qwenwork upstream ${upstream.status}: ${String(detail).substring(0, 500)}` } });
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.flushHeaders();
      const adapter = new AnthropicStreamAdapter({ id, model: modelKey });
      try {
        await client.consumeSSE(upstream, {
          onChunk: (chunk) => {
            const delta = chunk?.choices?.[0]?.delta;
            if (!delta) return;
            const d = {};
            if (delta.content) d.content = delta.content;
            if (delta.reasoning_content) d.reasoning_content = delta.reasoning_content;
            if (delta.finish_reason) d.finish_reason = delta.finish_reason;
            if (Object.keys(d).length === 0) return;
            for (const line of adapter.push(d)) res.write(line);
          },
          onUsage: (u) => { adapter.usage = u; },
        });
        for (const line of adapter.finish()) res.write(line);
        res.end();
      } catch {
        try {
          for (const line of adapter.finish()) res.write(line);
          res.end();
        } catch { res.end(); }
      }
      return;
    }

    let content = '';
    let reasoning = '';
    let usage = null;
    try {
      const r = await client.consumeSSE(upstream, {
        onChunk: (chunk) => {
          const c = chunk?.choices?.[0];
          if (!c) return;
          if (c.delta?.content) content += c.delta.content;
          if (c.delta?.reasoning_content) reasoning += c.delta.reasoning_content;
        },
        onUsage: (u) => { usage = u; },
      });
      usage = usage || r.usage;
    } catch (e) {
      return res.status(502).json({ error: { type: 'api_error', message: `upstream stream error: ${e.message}` } });
    }
    res.json(buildAnthropicResponse({ id, model: modelKey, content, reasoning, usage }));
  });

  const server = app.listen(port, host, () => {
    if (!options.quiet) {
      console.log(`[qwen-api] listening on http://${host}:${port}`);
    }
  });

  return {
    server,
    port,
    host,
    state,
    client,
    cred,
    apiKey: apiKey || null,
    apiKeySource,
    apiKeyFile,
    allowNoKey,
    getLocalBaseUrl: () => `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
  };
}
