/**
 * qwen-api - DeepSeek Harness plugin entry (host half)
 *
 * When this plugin is mounted in a profile, it starts the 千问办公
 * (QwenWorkCN) -> OpenAI / Anthropic compatible proxy server so any local
 * agent (Claude Code, Cursor, Cline, ...) can consume QwenWorkCN credits
 * through http://localhost:PORT.
 *
 * Plugin config (cordis.patch.yml insert row -> config):
 *   port:         listen port (default: env PORT or 9221)
 *   host:         bind address (default 127.0.0.1)
 *   apiKey:       client API key (default: auto-generated sk-qw-… persisted
 *                 to ~/.qwen-api/api-key.json and printed to the log)
 *   gateway:      upstream gateway base URL (default: https://gateway.qwenwork.cn)
 *   wasmPath:     path to qoder_auth_wasm_bg.wasm (default: bundled copy)
 *   appData:      QwenWorkCN Electron userData dir (default: %APPDATA%\QwenWorkCN)
 *   cliHome:      CLI home dir (default: %USERPROFILE%\.qwenworkcn)
 *   machineId:    manual machine-id override
 *   uid:          manual account uid override
 *   defaultModel: pro | flash | qwen3.8-max-preview (default: pro)
 *   quiet:        suppress banner logs
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startServer } = require('../src/server-core.js');

export const name = 'qwen-api';

export function apply(ctx, config = {}) {
  const handle = startServer({
    port: config.port,
    host: config.host,
    apiKey: config.apiKey,
    gateway: config.gateway,
    wasmPath: config.wasmPath,
    appData: config.appData,
    cliHome: config.cliHome,
    machineId: config.machineId,
    uid: config.uid,
    defaultModel: config.defaultModel,
    quiet: config.quiet,
  });

  const base = handle.getLocalBaseUrl();
  ctx.logger?.info(
    `[qwen-api] listening on ${base} | apiKey=${handle.apiKey ?? '(none)'}`
  );
  if (handle.apiKeySource === 'auto') {
    ctx.logger?.info(`[qwen-api] API key persisted at ${handle.apiKeyFile} (delete to rotate)`);
  }

  ctx.effect(() => () => {
    handle.client.resetContext();
    handle.server.close();
    ctx.logger?.info('[qwen-api] proxy stopped');
  });
}
