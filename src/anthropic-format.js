/**
 * anthropic-format.js — convert between the Anthropic Messages API and the
 * qwenwork infer format.
 *
 * The qwenwork upstream is a hybrid:
 *   - plain text travels as Anthropic-style content blocks
 *   - tools and tool history travel OpenAI-style:
 *       tools:        [{ type:'function', function:{ name, description, parameters } }]
 *       tool calls:   assistant message field `tool_calls`
 *       tool results: { role:'tool', tool_call_id, content }
 *
 * IMPORTANT: every streamed event block returned by AnthropicStreamAdapter ends
 * with a blank line ("\n\n"). SSE requires blank-line separation; emitting
 * "event: x\ndata: {...}\n" blocks back-to-back makes compliant parsers (Claude
 * Code) concatenate them into one unparseable event.
 */

const STOP_REASON_MAP = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  content_filter: 'end_turn',
};

export function mapStopReason(finishReason) {
  return STOP_REASON_MAP[finishReason] || 'end_turn';
}

function sse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Anthropic request tools -> OpenAI-style tools for the upstream. */
export function anthropicToolsToOpenAI(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter(t => t && typeof t === 'object' && t.name)
    .map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description ?? '',
        parameters: t.input_schema ?? { type: 'object', properties: {} },
      },
    }));
}

/** Convert an Anthropic Messages request body into qwenwork messages. */
export function anthropicToQwenworkMessages(body) {
  const out = [];
  const sys = body?.system;
  const systemText = Array.isArray(sys)
    ? sys.map(b => (typeof b === 'string' ? b : b?.text ?? '')).join('\n')
    : (typeof sys === 'string' ? sys : '');
  if (systemText.trim()) {
    out.push({ role: 'system', content: [{ type: 'text', text: systemText }] });
  }
  for (const msg of body?.messages || []) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const content = msg.content;

    if (role === 'assistant') {
      const textBlocks = [];
      const toolCalls = [];
      if (typeof content === 'string') {
        textBlocks.push({ type: 'text', text: content });
      } else if (Array.isArray(content)) {
        for (const b of content) {
          if (!b || typeof b !== 'object') continue;
          if (b.type === 'text') {
            textBlocks.push({ type: 'text', text: b.text ?? '' });
          } else if (b.type === 'thinking' && b.thinking) {
            textBlocks.push({ type: 'text', text: b.thinking });
          } else if (b.type === 'tool_use') {
            toolCalls.push({
              id: b.id ?? `call_${toolCalls.length}`,
              type: 'function',
              function: { name: b.name ?? '', arguments: JSON.stringify(b.input ?? {}) },
            });
          }
        }
      }
      const entry = {
        role: 'assistant',
        content: textBlocks.length > 0 ? textBlocks : [{ type: 'text', text: '' }],
      };
      if (toolCalls.length > 0) entry.tool_calls = toolCalls;
      out.push(entry);
      continue;
    }

    // user turn: text/image blocks plus any tool_result blocks
    const textBlocks = [];
    const toolResults = [];
    if (typeof content === 'string') {
      textBlocks.push({ type: 'text', text: content });
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text') {
          textBlocks.push({ type: 'text', text: b.text ?? '' });
        } else if (b.type === 'image' && b.source) {
          if (b.source.type === 'base64') {
            textBlocks.push({
              type: 'image',
              source: { type: 'base64', media_type: b.source.media_type, data: b.source.data },
            });
          } else if (b.source.type === 'url') {
            textBlocks.push({ type: 'image', source: { type: 'url', url: b.source.url } });
          }
        } else if (b.type === 'tool_result') {
          const t = typeof b.content === 'string'
            ? b.content
            : Array.isArray(b.content)
              ? b.content.map(x => x?.text ?? '').join('\n')
              : JSON.stringify(b.content ?? '');
          toolResults.push({ role: 'tool', tool_call_id: b.tool_use_id ?? '', content: t });
        }
      }
    }
    if (textBlocks.length === 0 && toolResults.length > 0) {
      out.push(...toolResults);
    } else {
      if (textBlocks.length === 0) textBlocks.push({ type: 'text', text: '' });
      out.push({ role: 'user', content: textBlocks });
      out.push(...toolResults);
    }
  }
  return out;
}

/** Non-stream Anthropic response. */
export function buildAnthropicResponse({ id, model, content, reasoning, usage, stopReason, toolCalls }) {
  const contentBlocks = [];
  if (reasoning) contentBlocks.push({ type: 'thinking', thinking: reasoning });
  if (content) contentBlocks.push({ type: 'text', text: content });
  for (const tc of toolCalls || []) {
    let input = {};
    try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { input = {}; }
    contentBlocks.push({
      type: 'tool_use',
      id: tc.id ?? `call_${contentBlocks.length}`,
      name: tc.function?.name ?? '',
      input,
    });
  }
  const hasTools = (toolCalls?.length ?? 0) > 0;
  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content: contentBlocks,
    stop_reason: stopReason || (hasTools ? 'tool_use' : 'end_turn'),
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
 *
 * Blocks are allocated indices in the order they open (thinking=0 when
 * present, then text, then each tool_use), so there are never index gaps.
 */
export class AnthropicStreamAdapter {
  constructor({ id, model }) {
    this.id = id;
    this.model = model;
    this.started = false;
    this.nextIndex = 0;
    this.thinking = null;   // { index }
    this.text = null;       // { index }
    this.tools = new Map(); // stream tc.index -> { blockIndex, id, name }
    this.usage = null;
    this.messageDeltaSent = false;
    this.messageStopSent = false;
  }

  push(delta = {}) {
    const lines = [];

    if (!this.started) {
      this.started = true;
      lines.push(sse('message_start', {
        type: 'message_start',
        message: {
          id: this.id, type: 'message', role: 'assistant', model: this.model,
          content: [], stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }));
    }

    if (delta.reasoning_content) {
      if (!this.thinking) {
        this.thinking = { index: this.nextIndex++ };
        lines.push(sse('content_block_start', {
          type: 'content_block_start', index: this.thinking.index,
          content_block: { type: 'thinking', thinking: '' },
        }));
      }
      lines.push(sse('content_block_delta', {
        type: 'content_block_delta', index: this.thinking.index,
        delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
      }));
    }

    if (delta.content) {
      if (this.thinking) {
        const idx = this.thinking.index;
        this.thinking = null;
        lines.push(sse('content_block_stop', { type: 'content_block_stop', index: idx }));
      }
      if (!this.text) {
        this.text = { index: this.nextIndex++ };
        lines.push(sse('content_block_start', {
          type: 'content_block_start', index: this.text.index,
          content_block: { type: 'text', text: '' },
        }));
      }
      lines.push(sse('content_block_delta', {
        type: 'content_block_delta', index: this.text.index,
        delta: { type: 'text_delta', text: delta.content },
      }));
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const streamIdx = tc.index ?? 0;
        let st = this.tools.get(streamIdx);
        if (!st) {
          st = { blockIndex: this.nextIndex++, id: tc.id ?? '', name: tc.function?.name ?? '' };
          this.tools.set(streamIdx, st);
          lines.push(sse('content_block_start', {
            type: 'content_block_start', index: st.blockIndex,
            content_block: { type: 'tool_use', id: st.id, name: st.name, input: {} },
          }));
        }
        if (tc.function?.arguments) {
          lines.push(sse('content_block_delta', {
            type: 'content_block_delta', index: st.blockIndex,
            delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
          }));
        }
      }
    }

    if (delta.finish_reason) {
      lines.push(...this.closeBlocks(delta.finish_reason));
    }

    return lines;
  }

  /** Close every open block and emit message_delta exactly once. */
  closeBlocks(finishReason) {
    const lines = [];
    if (this.thinking) {
      const idx = this.thinking.index;
      this.thinking = null;
      lines.push(sse('content_block_stop', { type: 'content_block_stop', index: idx }));
    }
    if (this.text) {
      const idx = this.text.index;
      this.text = null;
      lines.push(sse('content_block_stop', { type: 'content_block_stop', index: idx }));
    }
    for (const st of this.tools.values()) {
      lines.push(sse('content_block_stop', { type: 'content_block_stop', index: st.blockIndex }));
    }
    this.tools.clear();
    if (!this.messageDeltaSent) {
      this.messageDeltaSent = true;
      lines.push(sse('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: mapStopReason(finishReason), stop_sequence: null },
        usage: { output_tokens: this.usage?.completion_tokens ?? 0 },
      }));
    }
    return lines;
  }

  /** Terminal events; call once the upstream stream ends. Safe to call twice. */
  finish(finishReason) {
    const lines = [];
    if (!this.started) {
      this.started = true;
      lines.push(sse('message_start', {
        type: 'message_start',
        message: {
          id: this.id, type: 'message', role: 'assistant', model: this.model,
          content: [], stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }));
      this.text = { index: this.nextIndex++ };
      lines.push(sse('content_block_start', {
        type: 'content_block_start', index: this.text.index,
        content_block: { type: 'text', text: '' },
      }));
    }
    lines.push(...this.closeBlocks(finishReason));
    if (!this.messageStopSent) {
      this.messageStopSent = true;
      lines.push(sse('message_stop', { type: 'message_stop' }));
    }
    return lines;
  }
}
