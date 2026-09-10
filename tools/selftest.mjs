#!/usr/bin/env node
/**
 * tools/selftest.mjs — protocol self-test for the running qwen-api service
 *
 *   node tools/selftest.mjs            (uses PORT/.env and ~/.qwen-api key)
 *   node tools/selftest.mjs --quick    (skip the multi-turn section)
 *
 * Validates what real clients actually depend on:
 *   1. SSE framing: every event block separated by a blank line (spec)
 *   2. Anthropic state machine: block start/stop pairing, no index gaps,
 *      stop_reason present, message_stop present, all blocks closed
 *   3. OpenAI stream: finish_reason delivered before [DONE], usage present
 *   4. Multi-turn streaming on both endpoints
 *
 * Costs a tiny amount of quota (a few short completions).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const quick = process.argv.includes('--quick');

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
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'api-key.json'), 'utf8')).key; }
  catch { return process.env.API_KEY || ''; }
}

const port = readPort();
const key = readKey();
const base = `http://127.0.0.1:${port}`;
const model = process.env.QW_SELFTEST_MODEL || 'flash';

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? '[OK]  ' : '[FAIL]'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
};

async function post(pathname, body) {
  const res = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  return { res, text: await res.text() };
}

/** Spec-compliant SSE parse: events are blank-line separated. */
function parseSse(text) {
  const out = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    let ev = null; const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    let j = null;
    try { j = JSON.parse(data.join('\n')); } catch { /* invalid */ }
    out.push({ event: ev, data: j });
  }
  return out;
}

async function testAnthropic(label, messages, system) {
  console.log(`\n[anthropic] ${label}`);
  const { res, text } = await post('/v1/messages', {
    model, max_tokens: 300, stream: true, messages, ...(system ? { system } : {}),
  });
  check('HTTP 200', res.status === 200, `status=${res.status}`);
  check('content-type text/event-stream', (res.headers.get('content-type') || '').includes('text/event-stream'));
  check('blank-line separated events', text.includes('\n\n'));

  const events = parseSse(text);
  check('all events parse as JSON', events.every(e => e.data !== null), `${events.filter(e => !e.data).length} bad`);

  const blocks = new Map();
  const problems = [];
  let started = false, stopped = false, stopReason = null, textOut = '', thinkingOut = '';
  for (const e of events) {
    const t = e.data?.type;
    if (e.event && e.event !== t) problems.push(`event/data mismatch (${e.event} vs ${t})`);
    if (t === 'message_start') { if (started) problems.push('duplicate message_start'); started = true; }
    else if (t === 'content_block_start') {
      if (blocks.has(e.data.index)) problems.push(`block ${e.data.index} started twice`);
      blocks.set(e.data.index, e.data.content_block?.type);
    } else if (t === 'content_block_delta') {
      const type = blocks.get(e.data.index);
      if (!type) problems.push(`delta on unopened block ${e.data.index}`);
      if (e.data.delta?.type === 'text_delta') { textOut += e.data.delta.text ?? ''; if (type !== 'text') problems.push('text_delta into non-text block'); }
      if (e.data.delta?.type === 'thinking_delta') { thinkingOut += e.data.delta.thinking ?? ''; if (type !== 'thinking') problems.push('thinking_delta into non-thinking block'); }
    } else if (t === 'content_block_stop') {
      if (!blocks.has(e.data.index)) problems.push(`stop on unopened block ${e.data.index}`);
      blocks.delete(e.data.index);
    } else if (t === 'message_delta') stopReason = e.data.delta?.stop_reason ?? stopReason;
    else if (t === 'message_stop') stopped = true;
    else problems.push(`unknown event type ${t}`);
  }
  const indices = [...new Set(events.filter(e => e.data?.index !== undefined).map(e => e.data.index))].sort();
  check('message_start present', started);
  check('message_stop present', stopped);
  check('stop_reason present', !!stopReason, String(stopReason));
  check('no unclosed blocks', blocks.size === 0, [...blocks.keys()].join(','));
  check('no state-machine problems', problems.length === 0, problems.slice(0, 3).join('; '));
  check('no index gaps (0..n-1)', indices.length === 0 || indices.every((v, i) => v === i), indices.join(','));
  check('text content non-empty', textOut.trim().length > 0, JSON.stringify(textOut.substring(0, 40)));
  console.log(`         thinking=${thinkingOut.length} chars, text=${textOut.length} chars, stop_reason=${stopReason}`);
}

const WEATHER_TOOL_ANTH = {
  name: 'get_weather',
  description: '查询指定城市的天气',
  input_schema: { type: 'object', properties: { city: { type: 'string', description: '城市名' } }, required: ['city'] },
};
const WEATHER_TOOL_OAI = {
  type: 'function',
  function: { name: 'get_weather', description: '查询指定城市的天气', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
};

async function testOpenAITools(label) {
  console.log(`\n[openai] ${label}`);
  const { res, text } = await post('/v1/chat/completions', {
    model, stream: true, tools: [WEATHER_TOOL_OAI],
    messages: [{ role: 'user', content: '今天北京的天气怎么样？用 get_weather 查' }],
  });
  check('HTTP 200', res.status === 200, `status=${res.status}`);
  const chunks = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') continue;
    try { chunks.push(JSON.parse(payload)); } catch { /* skip */ }
  }
  const tcs = chunks.map(c => c.choices?.[0]?.delta?.tool_calls ?? []).flat();
  const fr = chunks.find(c => c.choices?.[0]?.finish_reason)?.choices[0].finish_reason;
  check('tool_calls fragments received', tcs.length > 0, `${tcs.length}`);
  check('finish_reason is tool_calls', fr === 'tool_calls', String(fr));
  const byIdx = new Map();
  for (const tc of tcs) {
    const acc = byIdx.get(tc.index ?? 0) || { id: '', name: '', args: '' };
    if (tc.id) acc.id = tc.id;
    if (tc.function?.name) acc.name = tc.function.name;
    if (tc.function?.arguments) acc.args += tc.function.arguments;
    byIdx.set(tc.index ?? 0, acc);
  }
  const first = [...byIdx.values()][0];
  check('tool call complete (id/name/args)', !!(first?.id && first?.name && first?.args?.includes('北京')), JSON.stringify(first).substring(0, 80));

  // follow-up turn carrying the tool result back to the model
  const { res: res2, text: text2 } = await post('/v1/chat/completions', {
    model, stream: true, tools: [WEATHER_TOOL_OAI],
    messages: [
      { role: 'user', content: '今天北京的天气怎么样？用 get_weather 查' },
      { role: 'assistant', content: '', tool_calls: [{ id: first.id, type: 'function', function: { name: 'get_weather', arguments: '{"city":"北京"}' } }] },
      { role: 'tool', tool_call_id: first.id, content: '{"weather":"晴","temperature":25}' },
      { role: 'user', content: '根据工具结果回答，北京天气如何？只回答一句话' },
    ],
  });
  check('follow-up HTTP 200', res2.status === 200, `status=${res2.status}`);
  let out2 = '';
  for (const line of text2.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') continue;
    try { const d = JSON.parse(payload).choices?.[0]?.delta?.content; if (d) out2 += d; } catch { /* skip */ }
  }
  check('follow-up uses the tool result', out2.includes('晴'), JSON.stringify(out2.substring(0, 60)));
}

async function testAnthropicTools(label) {
  console.log(`\n[anthropic] ${label}`);
  const { res, text } = await post('/v1/messages', {
    model, max_tokens: 300, stream: true, tools: [WEATHER_TOOL_ANTH],
    messages: [{ role: 'user', content: '今天北京的天气怎么样？用 get_weather 查' }],
  });
  check('HTTP 200', res.status === 200, `status=${res.status}`);
  const events = parseSse(text);
  const toolStart = events.find(e => e.data?.type === 'content_block_start' && e.data.content_block?.type === 'tool_use');
  const jsonDeltas = events.filter(e => e.data?.type === 'content_block_delta' && e.data.delta?.type === 'input_json_delta');
  const stopReason = events.find(e => e.data?.type === 'message_delta')?.data?.delta?.stop_reason;
  check('tool_use block started', !!toolStart, JSON.stringify(toolStart?.data?.content_block ?? {}).substring(0, 80));
  check('input_json_delta fragments received', jsonDeltas.length > 0, `${jsonDeltas.length}`);
  check('stop_reason is tool_use', stopReason === 'tool_use', String(stopReason));

  const toolId = toolStart?.data?.content_block?.id ?? '';
  const { res: res2, text: text2 } = await post('/v1/messages', {
    model, max_tokens: 300, stream: true, tools: [WEATHER_TOOL_ANTH],
    messages: [
      { role: 'user', content: '今天北京的天气怎么样？用 get_weather 查' },
      { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'get_weather', input: { city: '北京' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: '{"weather":"晴","temperature":25}' }] },
      { role: 'user', content: '根据工具结果回答，北京天气如何？只回答一句话' },
    ],
  });
  check('follow-up HTTP 200', res2.status === 200, `status=${res2.status}`);
  const events2 = parseSse(text2);
  const out2 = events2.filter(e => e.data?.type === 'content_block_delta' && e.data.delta?.type === 'text_delta').map(e => e.data.delta.text).join('');
  check('follow-up uses the tool result', out2.includes('晴'), JSON.stringify(out2.substring(0, 60)));
}

async function testOpenAI(label, messages) {
  console.log(`\n[openai] ${label}`);
  const { res, text } = await post('/v1/chat/completions', { model, stream: true, messages });
  check('HTTP 200', res.status === 200, `status=${res.status}`);
  const chunks = [];
  let bad = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') continue;
    try { chunks.push(JSON.parse(payload)); } catch { bad++; }
  }
  const finish = chunks.find(c => c.choices?.[0]?.finish_reason)?.choices[0].finish_reason ?? null;
  const usage = chunks.find(c => c.usage)?.usage ?? null;
  const content = chunks.map(c => c.choices?.[0]?.delta?.content ?? '').join('');
  check('all chunks parse as JSON', bad === 0, `${bad} bad`);
  check('[DONE] terminator present', text.includes('[DONE]'));
  check('finish_reason delivered before [DONE]', !!finish, String(finish));
  check('usage present', !!usage, usage ? `total=${usage.total_tokens}` : '');
  check('content non-empty', content.trim().length > 0, JSON.stringify(content.substring(0, 40)));
}

console.log('');
console.log('qwen-api protocol self-test');
console.log('='.repeat(52));
console.log(`target: ${base}  model: ${model}`);

await testAnthropic('single turn, no thinking', [{ role: 'user', content: '回复两个字：好的' }]);
await testAnthropic('single turn, system prompt', [{ role: 'user', content: '9*9等于几？只输出算式和结果' }], '你是一个简洁的计算器');
await testOpenAI('single turn', [{ role: 'user', content: '回复两个字：好的' }]);

// tool use — the thing agent clients need to keep working turn after turn
await testOpenAITools('tool call + result round trip');
await testAnthropicTools('tool call + result round trip');

if (!quick) {
  const turns = [
    { role: 'user', content: '记住数字 42' },
    { role: 'assistant', content: '好的，记住了 42。' },
    { role: 'user', content: '我刚才让你记的数字是多少？只输出数字' },
  ];
  await testAnthropic('multi-turn context', turns);
  await testOpenAI('multi-turn context', turns);
}

console.log('');
console.log('='.repeat(52));
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
