/**
 * credentials.js — resolve the 千问办公 account identity used for signing.
 *
 * Inference requests are signed by the qoder-auth wasm from:
 *   { uid, organization_id, organization_tags, data_policy_agreed }
 * so the only hard requirement is the account `uid` (+ machine id).
 *
 * The Bearer JWT is only needed for account/quota queries. Sources, in order:
 *   1. QW_TOKEN env
 *   2. decrypted %APPDATA%\QwenWorkCN\auth-v2.dat  (freshest; DPAPI + AES-GCM)
 *   3. cached <dataDir>/token.json (written by our own refresh)
 *
 * The Chromium OSCrypt v10 blob in auth-v2.dat is:
 *   "v10" || 12-byte nonce || AES-256-GCM ciphertext || 16-byte tag
 * with the key being the DPAPI-unwrapped `os_crypt.encrypted_key` from
 * the `Local State` file (prefix "DPAPI" stripped). Node cannot call DPAPI
 * natively on Windows, so we shell out once to powershell.exe to unwrap it.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export class CredentialError extends Error {
  constructor(message) { super(message); this.name = 'CredentialError'; }
}

export function resolveConfig(env = process.env) {
  const appData = env.QW_APPDATA || path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'QwenWorkCN');
  const cliHome = env.QW_CLI_HOME || path.join(os.homedir(), '.qwenworkcn');
  return {
    gateway: env.QW_GATEWAY || 'https://gateway.qwenwork.cn',
    appData,
    cliHome,
    machineId: env.QW_MACHINE_ID || null,
    uid: env.QW_UID || null,
    token: env.QW_TOKEN || null,
    refreshToken: env.QW_REFRESH_TOKEN || null,
    cliVersion: env.QW_CLI_VERSION || '1.1.32',
    defaultModel: env.QW_DEFAULT_MODEL || 'pro',
    dataDir: env.QW_DATA_DIR || path.join(os.homedir(), '.qwen-api'),
    wasmPath: env.QW_WASM_PATH || null,
  };
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return null; }
}

/** Unwrap the Chromium os_crypt key via PowerShell DPAPI (Windows). */
async function unwrapOsCryptKey(appDataDir) {
  const localStatePath = path.join(appDataDir, 'Local State');
  if (!fs.existsSync(localStatePath)) return null;
  const localState = readJsonSafe(localStatePath);
  const encKeyB64 = localState?.os_crypt?.encrypted_key;
  if (!encKeyB64) return null;
  // PS: base64 -> bytes -> strip 5-byte "DPAPI" prefix -> ProtectedData.Unwrap -> hex
  const script = [
    'Add-Type -AssemblyName System.Security;',
    `$b = [Convert]::FromBase64String('${encKeyB64}');`,
    '$b = $b[5..($b.Length-1)];',
    '$k = [Security.Cryptography.ProtectedData]::Unprotect($b, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser);',
    '($k | ForEach-Object { $_.ToString("x2") }) -join ""',
  ].join('\n');
  try {
    const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000, windowsHide: true });
    const hex = stdout.trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
    return null;
  } catch { return null; }
}

/** Decrypt a Chromium OSCrypt v10 blob with the given 32-byte key. */
function decryptOsCryptBlob(buf, key) {
  if (!buf || buf.length < 31) return null;
  const prefix = buf.subarray(0, 3).toString('utf8');
  if (prefix !== 'v10') return null;
  const nonce = buf.subarray(3, 15);
  const ct = buf.subarray(15);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(ct.subarray(ct.length - 16));
    const pt = Buffer.concat([decipher.update(ct.subarray(0, ct.length - 16)), decipher.final()]);
    return pt.toString('utf8');
  } catch { return null; }
}

/**
 * Decrypt %APPDATA%\QwenWorkCN\auth-v2.dat -> { token, refreshToken, user }
 * Returns null when unavailable (not logged in / not Windows / decrypt fail).
 */
export async function decryptAuthV2(appDataDir) {
  const authPath = path.join(appDataDir, 'auth-v2.dat');
  if (!fs.existsSync(authPath)) return null;
  let raw;
  try { raw = fs.readFileSync(authPath); } catch { return null; }
  const key = await unwrapOsCryptKey(appDataDir);
  if (!key) return null;
  const json = decryptOsCryptBlob(raw, key);
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

/** Read machine id from the CLI home (fallback: random per-run). */
export function readMachineId(cliHome, override) {
  if (override) return override;
  try {
    const v = fs.readFileSync(path.join(cliHome, 'machine-id'), 'utf8').trim();
    if (v) return v;
  } catch { /* ignore */ }
  return crypto.randomUUID();
}

/**
 * Build the signer identity: { uid, machineId, core, userInfoForAuth }
 * Requires the wasm to be loaded (generateRuntimeAuthFields).
 */
export function buildIdentity({ auth, machineId, wasm }) {
  const uid = auth?.user?.id || auth?.user?.uid || auth?.uid;
  if (!uid) throw new CredentialError('No account uid available. Log in to the 千问办公 desktop app once, or set QW_UID.');
  const core = {
    uid,
    organization_id: auth?.user?.organization_id ?? auth?.organization_id ?? '',
    organization_tags: auth?.user?.organization_tags ?? auth?.organization_tags ?? [],
    data_policy_agreed: auth?.user?.data_policy_agreed ?? auth?.data_policy_agreed ?? true,
  };
  const runtime = JSON.parse(wasm.generateRuntimeAuthFields(JSON.stringify(core)));
  const userInfoForAuth = {
    uid: core.uid,
    encrypt_user_info: runtime.encrypt_user_info,
    key: runtime.key,
    organization_id: core.organization_id,
    organization_tags: core.organization_tags,
    data_policy_agreed: core.data_policy_agreed,
  };
  return { uid, machineId, core, userInfoForAuth };
}

/**
 * Credential manager: keeps the freshest Bearer token for quota queries.
 * - tries auth-v2.dat live decrypt (desktop app keeps it fresh)
 * - falls back to our persisted token.json
 * - refreshes via /api/v1/deviceToken/refresh when a query returns 401
 */
export class CredentialManager {
  constructor(cfg, wasm) {
    this.cfg = cfg;
    this.wasm = wasm;
    this.cachedAuth = null;      // decrypted auth-v2.dat payload
    this.cachedToken = null;     // { device_token, refresh_token, expires_at }
    this.refreshPromise = null;
    this.identity = null;
  }

  async init() {
    // 1. live decrypt (best source when the desktop app is installed & logged in)
    this.cachedAuth = await decryptAuthV2(this.cfg.appData);
    // 2. our persisted refresh result
    const persisted = readJsonSafe(path.join(this.cfg.dataDir, 'token.json'));
    if (persisted?.device_token) this.cachedToken = persisted;
    // 3. env override
    if (this.cfg.token) this.envToken = this.cfg.token;
    this.machineId = readMachineId(this.cfg.cliHome, this.cfg.machineId);
    this.buildIdentity();
  }

  buildIdentity() {
    const authLike = this.cachedAuth || {
      user: this.cfg.uid ? { id: this.cfg.uid } : null,
    };
    try {
      this.identity = buildIdentity({ auth: authLike, machineId: this.machineId, wasm: this.wasm });
    } catch (e) {
      this.identity = null;
      this.identityError = e;
    }
  }

  get uid() {
    return this.identity?.uid || this.cfg.uid || null;
  }

  /** Best-effort Bearer token for account/quota queries. */
  async getBearerToken() {
    if (this.cfg.token) return this.cfg.token;
    if (this.cachedToken?.device_token) return this.cachedToken.device_token;
    if (this.cachedAuth?.token) return this.cachedAuth.token;
    return null;
  }

  async getRefreshToken() {
    if (this.cfg.refreshToken) return this.cfg.refreshToken;
    if (this.cachedToken?.refresh_token) return this.cachedToken.refresh_token;
    if (this.cachedAuth?.refreshToken) return this.cachedAuth.refreshToken;
    return null;
  }

  /** Refresh the device token via the gateway. Rotates the refresh token. */
  async refreshToken() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const rt = await this.getRefreshToken();
        if (!rt) throw new CredentialError('No refresh token available');
        const res = await fetch(`${this.cfg.gateway}/api/v1/deviceToken/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'qoderwork/1.0.4' },
          body: JSON.stringify({ refresh_token: rt, target: 'c' }),
        });
        if (!res.ok) {
          // our refresh token went stale (desktop app rotated it) -> re-decrypt
          this.cachedAuth = await decryptAuthV2(this.cfg.appData);
          if (this.cachedAuth?.refreshToken && this.cachedAuth.refreshToken !== rt) {
            const retry = await fetch(`${this.cfg.gateway}/api/v1/deviceToken/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'User-Agent': 'qoderwork/1.0.4' },
              body: JSON.stringify({ refresh_token: this.cachedAuth.refreshToken, target: 'c' }),
            });
            if (!retry.ok) throw new CredentialError(`refresh failed: HTTP ${retry.status}`);
            const j = await retry.json();
            this.persistToken(j);
            return j.device_token;
          }
          throw new CredentialError(`refresh failed: HTTP ${res.status}`);
        }
        const j = await res.json();
        this.persistToken(j);
        return j.device_token;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  persistToken(j) {
    this.cachedToken = j;
    try {
      fs.mkdirSync(this.cfg.dataDir, { recursive: true });
      fs.writeFileSync(path.join(this.cfg.dataDir, 'token.json'), JSON.stringify(j, null, 2));
    } catch { /* best effort */ }
  }

  /** GET account-context (quota). Auto-refreshes once on 401. */
  async fetchAccountContext() {
    const doFetch = async (token) => {
      const res = await fetch(`${this.cfg.gateway}/api/v1/adapter/user/account-context?include=user,plan,quota`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'qoderwork/1.0.4' },
      });
      return res;
    };
    let token = await this.getBearerToken();
    if (!token) return { ok: false, error: 'no-token' };
    let res = await doFetch(token);
    if (res.status === 401 || res.status === 403) {
      try {
        token = await this.refreshToken();
        res = await doFetch(token);
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const j = await res.json();
    return { ok: true, data: j?.data ?? j };
  }
}
