/**
 * qoder-wasm.js — standalone wasm-bindgen glue for qoder_auth_wasm_bg.wasm
 *
 * Reconstructed from the QwenWorkCN (千问办公) desktop app main bundle and
 * the qoderclicn CLI glue. Provides the request-signing primitives that the
 * gateway (gateway.qwenwork.cn) requires:
 *
 *   - generateRuntimeAuthFields(coreJson) -> { encrypt_user_info, key }
 *   - new QoderContext(machineId, cliVersion, userInfoJson, businessJson)
 *   - ctx.prepareInferRequest(endpoint, bodyJson, modelKey, modelSource)
 *       -> RequestResult { url, headers (Map), body (string), free() }
 *   - ctx.prepareRequest(endpoint, path, method, requestClass, body?, headersJson?)
 *   - decryptServerResponse(text)
 *   - modelCacheDecrypt(content, uid)
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
const nodeRequire = typeof require === 'function' ? require : createRequire(import.meta.url);

let wasm;
let heap = new Array(1024).fill(void 0);
heap.push(void 0, null, true, false);
let heap_next = heap.length;
let WASM_VECTOR_LEN = 0;

function addHeapObject(obj) {
  if (heap_next === heap.length) heap.push(heap.length + 1);
  const idx = heap_next;
  heap_next = heap[idx];
  heap[idx] = obj;
  return idx;
}
function dropObject(idx) {
  if (idx < 1028) return;
  heap[idx] = heap_next;
  heap_next = idx;
}
function getObject(idx) { return heap[idx]; }
function takeObject(idx) { const obj = getObject(idx); dropObject(idx); return obj; }
function isLikeNone(x) { return x == null; }

function handleError(f, args) {
  try { return f.apply(this, args); }
  catch (e) { wasm.__wbindgen_export(addHeapObject(e)); }
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
function getStringFromWasm0(ptr, len) { ptr = ptr >>> 0; return decodeText(ptr, len); }

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}
let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
  if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true ||
      (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  }
  return cachedDataViewMemory0;
}
function getArrayU8FromWasm0(ptr, len) { ptr = ptr >>> 0; return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len); }

const cachedTextEncoder = new TextEncoder();
if (!('encodeInto' in cachedTextEncoder)) {
  cachedTextEncoder.encodeInto = function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return { read: arg.length, written: buf.length };
  };
}
function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === undefined) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr;
  }
  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;
  const mem = getUint8ArrayMemory0();
  let offset = 0;
  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 0x7F) break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) arg = arg.slice(offset);
    ptr = realloc(ptr, len, (len = offset + arg.length * 3), 1) >>> 0;
    const sub = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
    const res = cachedTextEncoder.encodeInto(arg, sub);
    offset += res.written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }
  WASM_VECTOR_LEN = offset;
  return ptr;
}

function __wbg_get_imports() {
  return {
    __proto__: null,
    './qoder_auth_wasm_bg.js': {
      __proto__: null,
      __wbg_Error_2e59b1b37a9a34c3: function (arg0, arg1) {
        const e = Error(getStringFromWasm0(arg0, arg1));
        return addHeapObject(e);
      },
      __wbg___wbindgen_is_function_49868bde5eb1e745: function (arg0) {
        return typeof getObject(arg0) === 'function';
      },
      __wbg___wbindgen_is_object_40c5a80572e8f9d3: function (arg0) {
        const val = getObject(arg0);
        return typeof val === 'object' && val !== null;
      },
      __wbg___wbindgen_is_string_b29b5c5a8065ba1a: function (arg0) {
        return typeof getObject(arg0) === 'string';
      },
      __wbg___wbindgen_is_undefined_c0cca72b82b86f4d: function (arg0) {
        return getObject(arg0) === void 0;
      },
      __wbg___wbindgen_throw_81fc77679af83bc6: function (arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
      },
      __wbg_call_d578befcc3145dee: function () {
        return handleError(function (arg0, arg1, arg2) {
          const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
          return addHeapObject(ret);
        }, arguments);
      },
      __wbg_crypto_38df2bab126b63dc: function (arg0) {
        const ret = getObject(arg0).crypto;
        return addHeapObject(ret);
      },
      __wbg_getRandomValues_c44a50d8cfdaebeb: function () {
        return handleError(function (arg0, arg1) {
          getObject(arg0).getRandomValues(getObject(arg1));
        }, arguments);
      },
      __wbg_getRandomValues_d49329ff89a07af1: function () {
        return handleError(function (arg0, arg1) {
          globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments);
      },
      __wbg_length_0c32cb8543c8e4c8: function (arg0) {
        return getObject(arg0).length;
      },
      __wbg_msCrypto_bd5a034af96bcba6: function (arg0) {
        const ret = getObject(arg0).msCrypto;
        return addHeapObject(ret);
      },
      __wbg_new_99cabae501c0a8a0: function () {
        return addHeapObject(new Map());
      },
      __wbg_new_with_length_9cedd08484b73942: function (arg0) {
        return addHeapObject(new Uint8Array(arg0 >>> 0));
      },
      __wbg_node_84ea875411254db1: function (arg0) {
        const ret = getObject(arg0).node;
        return addHeapObject(ret);
      },
      __wbg_now_88621c9c9a4f3ffc: function () {
        return Date.now();
      },
      __wbg_process_44c7a14e11e9f69e: function (arg0) {
        const ret = getObject(arg0).process;
        return addHeapObject(ret);
      },
      __wbg_prototypesetcall_3e05eb9545565046: function (arg0, arg1, arg2) {
        Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), getObject(arg2));
      },
      __wbg_randomFillSync_6c25eac9869eb53c: function () {
        return handleError(function (arg0, arg1) {
          getObject(arg0).randomFillSync(takeObject(arg1));
        }, arguments);
      },
      __wbg_require_b4edbdcf3e2a1ef0: function () {
        return handleError(function () {
          const ret = nodeRequire;
          return addHeapObject(ret);
        }, arguments);
      },
      __wbg_set_08463b1df38a7e29: function (arg0, arg1, arg2) {
        const ret = getObject(arg0).set(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
      },
      __wbg_static_accessor_GLOBAL_THIS_a1248013d790bf5f: function () {
        const ret = typeof globalThis === 'undefined' ? null : globalThis;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
      },
      __wbg_static_accessor_GLOBAL_f2e0f995a21329ff: function () {
        const ret = typeof global === 'undefined' ? null : global;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
      },
      __wbg_static_accessor_SELF_24f78b6d23f286ea: function () {
        const ret = typeof self === 'undefined' ? null : self;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
      },
      __wbg_static_accessor_WINDOW_59fd959c540fe405: function () {
        const ret = typeof window === 'undefined' ? null : window;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
      },
      __wbg_subarray_0f98d3fb634508ad: function (arg0, arg1, arg2) {
        const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0);
        return addHeapObject(ret);
      },
      __wbg_versions_276b2795b1c6a219: function (arg0) {
        const ret = getObject(arg0).versions;
        return addHeapObject(ret);
      },
      __wbindgen_cast_0000000000000001: function (arg0, arg1) {
        const len = arg1 === undefined ? WASM_VECTOR_LEN : arg1;
        const buf = getArrayU8FromWasm0(arg0, len).slice();
        return addHeapObject(buf);
      },
      __wbindgen_cast_0000000000000002: function (arg0, arg1) {
        const len = arg1 === undefined ? WASM_VECTOR_LEN : arg1;
        const s = getStringFromWasm0(arg0, len);
        return addHeapObject(s);
      },
      __wbindgen_object_clone_ref: function (arg0) {
        const ret = getObject(arg0);
        return addHeapObject(ret);
      },
      __wbindgen_object_drop_ref: function (arg0) {
        takeObject(arg0);
      },
    },
  };
}

function __wbg_finalize_init(instance) {
  wasm = instance.exports;
  cachedDataViewMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  return wasm;
}

export function initSync(moduleOrPath) {
  if (wasm !== void 0) return wasm;
  let mod = moduleOrPath;
  if (mod !== undefined && Object.getPrototypeOf(mod) === Object.prototype) {
    ({ module: mod } = mod);
  }
  const imports = __wbg_get_imports();
  if (!(mod instanceof WebAssembly.Module)) mod = new WebAssembly.Module(mod);
  const instance = new WebAssembly.Instance(mod, imports);
  return __wbg_finalize_init(instance);
}

export function load(wasmPath) {
  if (wasm !== void 0) return wasm;
  const buf = fs.readFileSync(wasmPath);
  return initSync({ module: buf });
}

export function isLoaded() { return wasm !== void 0; }

// ---------- one-string-in / string-out wrappers ----------

function callStr1(exportName, s) {
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const ptr = passStringToWasm0(s, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
    const len = WASM_VECTOR_LEN;
    wasm[exportName](retptr, ptr, len);
    const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
    const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
    const out = getStringFromWasm0(r0, r1);
    wasm.__wbindgen_export4(r0, r1, 1);
    return out;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

function callStr2(exportName, a, b) {
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const pa = passStringToWasm0(a, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
    const la = WASM_VECTOR_LEN;
    const pb = passStringToWasm0(b, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
    const lb = WASM_VECTOR_LEN;
    wasm[exportName](retptr, pa, la, pb, lb);
    const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
    const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
    const out = getStringFromWasm0(r0, r1);
    wasm.__wbindgen_export4(r0, r1, 1);
    return out;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/** Generate the runtime auth fields (encrypt_user_info / key) for a uid. */
export function generateRuntimeAuthFields(coreJson) {
  return callStr1('generate_runtime_auth_fields', coreJson);
}

/** Decrypt an encoded server response body (best effort). */
export function decryptServerResponse(s) {
  try { return callStr1('decrypt_server_response', s); } catch { return s; }
}

/** Decrypt the shared model catalog cache: modelCacheDecrypt(content, uid). */
export function modelCacheDecrypt(content, uid) {
  return callStr2('model_cache_decrypt', content, uid);
}

// ---------- RequestResult ----------

export class RequestResult {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(RequestResult.prototype);
    obj.__wbg_ptr = ptr;
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_requestresult_free(ptr, 0);
  }
  get body() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.requestresult_body(retptr, this.__wbg_ptr);
      const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
      const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
      let v;
      if (r0 !== 0) {
        v = getStringFromWasm0(r0, r1);
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
      }
      return v;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  get headerCount() {
    return wasm.requestresult_headerCount(this.__wbg_ptr) >>> 0;
  }
  /** Map<string, string> */
  get headers() {
    const ret = wasm.requestresult_headers(this.__wbg_ptr);
    return takeObject(ret);
  }
  get url() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.requestresult_url(retptr, this.__wbg_ptr);
      const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
      const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
      const s = getStringFromWasm0(r0, r1);
      wasm.__wbindgen_export4(r0, r1, 1);
      return s;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
}

// ---------- QoderContext ----------

export class QoderContext {
  constructor(machineId, cliVersion, userInfoJson, businessInfoJson) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const p0 = passStringToWasm0(machineId, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const l0 = WASM_VECTOR_LEN;
      const p1 = passStringToWasm0(cliVersion, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const l1 = WASM_VECTOR_LEN;
      const p2 = passStringToWasm0(userInfoJson, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const l2 = WASM_VECTOR_LEN;
      let p3 = 0, l3 = 0;
      if (businessInfoJson != null) {
        p3 = passStringToWasm0(businessInfoJson, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
        l3 = WASM_VECTOR_LEN;
      }
      wasm.qodercontext_new(retptr, p0, l0, p1, l1, p2, l2, p3, l3);
      const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
      const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
      const r2 = getDataViewMemory0().getInt32(retptr + 8, true);
      if (r2) throw takeObject(r1);
      this.__wbg_ptr = r0 >>> 0;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  free() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    wasm.__wbg_qodercontext_free(ptr, 0);
  }
  prepareInferRequest(endpoint, bodyJson, modelKey, modelSource) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const p0 = passStringToWasm0(endpoint, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const l0 = WASM_VECTOR_LEN;
      const p1 = passStringToWasm0(bodyJson, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const l1 = WASM_VECTOR_LEN;
      let p2 = 0, l2 = 0;
      if (modelKey != null) {
        p2 = passStringToWasm0(modelKey, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
        l2 = WASM_VECTOR_LEN;
      }
      let p3 = 0, l3 = 0;
      if (modelSource != null) {
        p3 = passStringToWasm0(modelSource, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
        l3 = WASM_VECTOR_LEN;
      }
      wasm.qodercontext_prepareInferRequest(retptr, this.__wbg_ptr, p0, l0, p1, l1, p2, l2, p3, l3);
      const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
      const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
      const r2 = getDataViewMemory0().getInt32(retptr + 8, true);
      if (r2) throw takeObject(r1);
      return RequestResult.__wrap(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  prepareRequest(endpoint, path, method, requestClass, body, headersJson) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const p0 = passStringToWasm0(endpoint, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const l0 = WASM_VECTOR_LEN;
      const p1 = passStringToWasm0(path, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const l1 = WASM_VECTOR_LEN;
      const p2 = passStringToWasm0(method, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const l2 = WASM_VECTOR_LEN;
      const p3 = passStringToWasm0(requestClass, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const l3 = WASM_VECTOR_LEN;
      let p4 = 0, l4 = 0;
      if (body != null) {
        p4 = passStringToWasm0(body, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
        l4 = WASM_VECTOR_LEN;
      }
      let p5 = 0, l5 = 0;
      if (headersJson != null) {
        p5 = passStringToWasm0(headersJson, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
        l5 = WASM_VECTOR_LEN;
      }
      wasm.qodercontext_prepareRequest(retptr, this.__wbg_ptr, p0, l0, p1, l1, p2, l2, p3, l3, p4, l4, p5, l5);
      const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
      const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
      const r2 = getDataViewMemory0().getInt32(retptr + 8, true);
      if (r2) throw takeObject(r1);
      return RequestResult.__wrap(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  refreshAuthFields(userInfoJson) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const p0 = passStringToWasm0(userInfoJson, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const l0 = WASM_VECTOR_LEN;
      wasm.qodercontext_refreshAuthFields(retptr, this.__wbg_ptr, p0, l0);
      const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
      const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
      if (r1) throw takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
}
