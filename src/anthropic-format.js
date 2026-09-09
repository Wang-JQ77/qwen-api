/**
 * anthropic-format.js — Anthropic Messages API <-> qwenwork infer format
 *
 * Enables Claude Code and other Anthropic-native clients to talk to the
 * proxy via POST /v1/messages (streaming + non-streaming).
 */

/** Anthropic request body -> qwenwork messages */
export function anthropicToQwenworkMessages(body) {
  const out = [];
  if (body.system) {
    const sysText = typeof body.system === 'string'
      ? body.system
      : (body.system || []).map(b => b?.text ?? '').join('\n');
    if (sysText) out.push({ role: 'system', content: [{ type: 'text', text: sysText }] });
  }
  for (const msg of body.messages || []) {
    const blocks = [];
    for (const b of msg.content || []) {
      if (typeof b === 'string') { blocks.push({ type: 'text', text: b }); continue; }
      if (b?.type === 'text') blocks.push({ type: 'text', text: b.text ?? '' });
      else if (b?.type === 'image' && b?.source) blocks.push({ type: 'image', source: b.source });
      else if (b?.type === 'tool_result') {
        const text = typeof b.content === 'string' ? b.content
          : (b.content || []).map(x => x?.text ?? '').join('\n');
        blocks.push({ type: 'text', text: `[tool result] ${text}` });
      } else if (b?.type === 'tool_use') {
        blocks.push({ type: 'text', text: `[tool call ${b.name}] ${JSON.stringify(b.input ?? {})}` });
      }
    }
    if (blocks.length) out.push({ role: msg.role, content: blocks });
  }
  return out;
}

/** Non-stream Anthropic response. */
export function buildAnthropicResponse({ id, model, content, reasoning, usage, stopReason }) {
  const contentBlocks = [];
  if (reasoning) contentBlocks.push({ type: 'thinking', thinking: reasoning });
  contentBlocks.push({ type: 'text', text: content ?? '' });
  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content: contentBlocks,
    stop_reason: stopReason || 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Streaming state machine: converts OpenAI-style deltas into the Anthropic
 * SSE event sequence Claude Code expects.
 */
export class AnthropicStreamAdapter {
  constructor({ id, model }) {
    this.id = id;
    this.model = model;
    this.started = false;
    this.textOpen = false;
    this.thinkingOpen = false;
    this.text = '';
    this.usage = null;
  }

  /** Feed one OpenAI delta {content?, reasoning_content?, finish_reason?}; returns SSE lines to emit. */
  push(delta) {
    const lines = [];
    if (!this.started) {
      this.started = true;
      lines.push(`event: message_start\ndata: ${JSON.stringify({
        type: 'message_start',
        message: {
          id: this.id, type: 'message', role: 'assistant', model: this.model,
          content: [], stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })}\n`);
    }
    if (delta.reasoning_content) {
      if (!this.thinkingOpen) {
        this.thinkingOpen = true;
        lines.push(`event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start', index: 0,
          content_block: { type: 'thinking', thinking: '' },
        })}\n`);
      }
      lines.push(`event: content_block_delta\ndata: ${JSON.stringify({
        type: 'content_block_delta', index: 0,
        delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
      })}\n`);
    } else if (delta.content) {
      if (this.thinkingOpen) {
        this.thinkingOpen = false;
        lines.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n`);
      }
      if (!this.textOpen) {
        this.textOpen = true;
        this.textIndex = this.thinkingOpen ? 0 : (lines.length >= 0 ? 1 : 0);
        // index: thinking occupied 0; text starts at 1 (or 0 when no thinking)
        this.textIndex = 1;
        lines.push(`event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start', index: 1,
          content_block: { type: 'text', text: '' },
        })}\n`);
      }
      lines.push(`event: content_block_delta\ndata: ${JSON.stringify({
        type: 'content_block_delta', index: 1,
        delta: { type: 'text_delta', text: delta.content },
      })}\n`);
    }
    if (delta.finish_reason) {
      if (this.thinkingOpen) {
        this.thinkingOpen = false;
        lines.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n`);
      }
      if (this.textOpen) {
        this.textOpen = false;
        lines.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 1 })}\n`);
      }
      lines.push(`event: message_delta\ndata: ${JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: this.usage?.completion_tokens ?? 0 },
      })}\n`);
    }
    return lines;
  }

  /** Terminal events; call once the upstream stream ends. */
  finish() {
    const lines = [];
    if (this.started) {
      if (this.thinkingOpen) lines.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n`);
      if (this.textOpen) lines.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 1 })}\n`);
      lines.push(`event: message_delta\ndata: ${JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: this.usage?.completion_tokens ?? 0 },
      })}\n`);
    } else {
      // empty response: emit a minimal valid message
      lines.push(`event: message_start\ndata: ${JSON.stringify({
        type: 'message_start',
        message: {
          id: this.id, type: 'message', role: 'assistant', model: this.model,
          content: [], stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })}\n`);
      lines.push(`event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' },
      })}\n`);
      lines.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n`);
      lines.push(`event: message_delta\ndata: ${JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 0 },
      })}\n`);
    }
    lines.push(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n`);
    return lines;
  }
}
