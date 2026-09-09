/**
 * qwenwork-client.js — signed inference client for gateway.qwenwork.cn
 *
 * Signs every request with the qoder-auth wasm (COSY auth) and consumes the
 * SSE stream. The upstream already emits OpenAI chat.completion.chunk JSON,
 * wrapped as:
 *
 *   data:{"headers":{...},"body":"<openai chunk json or [DONE]>","statusCode":200,...}
 *   event:finish
 *   data:{"firstTokenDuration":...}
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as qaw from './qoder-wasm.js';

const INFER_PATH = '/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common';

export const DEFAULT_MODELS = [
  { key: 'pro', display_name: '高级', is_vl: true, is_reasoning: false, max_input_tokens: 180000, description: '性能均衡，擅长复杂任务' },
  { key: 'flash', display_name: '标准｜Qwen3.8-Flash', is_vl: true, is_reasoning: false, max_input_tokens: 180000, description: '极速全能，秒杀日常任务' },
  { key: 'qwen3.8-max-preview', display_name: 'Qwen3.8-Max', is_vl: true, is_reasoning: false, max_input_tokens: 180000, description: '千问最强模型' },
];

const MODEL_ALIASES = {
  default: 'pro',
  'qwenwork-pro': 'pro',
  'qwenwork-flash': 'flash',
  'qwenwork-max': 'qwen3.8-max-preview',
  qwen: 'pro',
};

export function normalizeModelKey(model, defaultModel = 'pro') {
  if (!model) return defaultModel;
  const lower = String(model).toLowerCase();
  return MODEL_ALIASES[lower] || lower;
}

export class QwenWorkClient {
  constructor({ gateway, wasmPath, identity, cliVersion = '1.1.32' }) {
    this.gateway = (gateway || 'https://gateway.qwenwork.cn').replace(/\/+$/, '');
    this.cliVersion = cliVersion;
    this.identity = identity;
    this.ctx = null;
    this.catalog = null;
    if (!qaw.isLoaded()) {
      qaw.load(wasmPath);
    }
  }

  setIdentity(identity) {
    this.identity = identity;
    this.resetContext();
  }

  resetContext() {
    if (this.ctx) { try { this.ctx.free(); } catch { /* ignore */ } this.ctx = null; }
  }

  getContext() {
    if (!this.identity) throw new Error('No signing identity (missing account uid)');
    if (!this.ctx) {
      const business = {
        client_type: '5',
        business_product: 'qoder_work',
        business_type: 'agent',
        scene: 'assistant',
      };
      this.ctx = new qaw.QoderContext(
        this.identity.machineId,
        this.cliVersion,
        JSON.stringify(this.identity.userInfoForAuth),
        JSON.stringify(business),
      );
    }
    return this.ctx;
  }

  /**
   * Sign and fire an inference request. `messages` are qwenwork-format
   * (role + Anthropic-style content blocks). Returns the fetch Response.
   */
  async infer({ modelKey, modelConfig, messages, requestId, sessionId, signal }) {
    const ctx = this.getContext();
    const now = Date.now();
    const reqId = requestId || `req-${now}-${crypto.randomBytes(4).toString('hex')}`;
    const bodyObj = {
      session_id: sessionId || `sess-${now}-${crypto.randomBytes(4).toString('hex')}`,
      request_id: reqId,
      request_set_id: `rset-${now}`,
      model_config: modelConfig,
      custom_model: null,
      messages,
      business: { id: '', product: 'qoder_work', type: 'agent' },
    };
    const bodyJson = JSON.stringify(bodyObj);
    const rr = ctx.prepareInferRequest(this.gateway, bodyJson, modelKey, modelConfig?.source || 'system');
    try {
      const headers = { 'User-Agent': `qoderclicn/${this.cliVersion}` };
      for (const [k, v] of rr.headers) headers[k] = v;
      return await fetch(rr.url, {
        method: 'POST',
        headers,
        body: rr.body,
        signal,
      });
    } finally {
      rr.free();
    }
  }

  /**
   * Parse the upstream SSE into OpenAI chunks.
   * onChunk(chunkJsonString) for each chunk body,
   * onUsage(usageObj) when a raw_usage chunk arrives,
   * resolves with { usage } at stream end.
   */
  async consumeSSE(response, { onChunk, onUsage, signal } = {}) {
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      let detail = text;
      try {
        // error responses also arrive as SSE data: lines
        const m = text.match(/data:(\{.*\})/);
        if (m) detail = JSON.parse(m[1])?.body ?? text;
      } catch { /* keep raw */ }
      const err = new Error(`upstream HTTP ${response.status}: ${String(detail).substring(0, 500)}`);
      err.status = response.status;
      throw err;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let usage = null;
    const handleLine = (line) => {
      line = line.trim();
      if (!line || line.startsWith('event:') || line.startsWith(':')) return;
      if (!line.startsWith('data:')) return;
      const payload = line.substring(5);
      if (payload === '[DONE]') return;
      let wrapper;
      try { wrapper = JSON.parse(payload); } catch { return; }
      let bodyStr = wrapper?.body;
      if (bodyStr == null || bodyStr === '') return;
      if (bodyStr === '[DONE]') return;
      // some deployments return the encrypted form; try decrypt when not JSON
      if (bodyStr.charAt(0) !== '{' && bodyStr.charAt(0) !== '[') {
        try { bodyStr = qaw.decryptServerResponse(bodyStr); } catch { /* ignore */ }
      }
      let chunk;
      try { chunk = JSON.parse(bodyStr); } catch { return; }
      if (chunk?.raw_usage) {
        usage = chunk.raw_usage.usage ?? chunk.raw_usage.data ?? chunk.raw_usage ?? null;
        if (onUsage) onUsage(usage);
        return;
      }
      if (onChunk) onChunk(chunk);
    };
    try {
      for (;;) {
        if (signal?.aborted) throw new Error('aborted');
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          handleLine(buf.substring(0, idx));
          buf = buf.substring(idx + 1);
        }
      }
      if (buf.trim()) handleLine(buf);
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
    return { usage };
  }

  /**
   * Model catalog: decrypt the shared cache the desktop app/CLI maintains,
   * falling back to built-in defaults.
   */
  async loadCatalog(cliHome, uid) {
    const candidates = [];
    if (uid) candidates.push(path.join(cliHome, '.models', uid, 'catalog-v6'));
    for (const f of candidates) {
      try {
        if (!fs.existsSync(f)) continue;
        const raw = fs.readFileSync(f, 'utf8');
        const dec = qaw.modelCacheDecrypt(raw, uid);
        const parsed = JSON.parse(dec);
        const scene = parsed?.qwork;
        if (Array.isArray(scene) && scene.length > 0) {
          this.catalog = scene;
          return this.catalog;
        }
      } catch { /* try next */ }
    }
    this.catalog = DEFAULT_MODELS;
    return this.catalog;
  }

  modelConfigForKey(key) {
    const entry = (this.catalog || DEFAULT_MODELS).find(m => m.key === key)
      || DEFAULT_MODELS.find(m => m.key === key)
      || { key, display_name: key, is_vl: false, is_reasoning: false, max_input_tokens: 180000 };
    return {
      key: entry.key,
      display_name: entry.display_name ?? '',
      model: entry.model ?? '',
      format: entry.format ?? 'openai',
      is_vl: entry.is_vl ?? false,
      is_reasoning: entry.is_reasoning ?? false,
      api_key: '',
      url: '',
      source: entry.source ?? 'system',
      max_input_tokens: entry.max_input_tokens ?? 180000,
    };
  }
}
