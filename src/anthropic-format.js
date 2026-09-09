/**
 * anthropic-format.js — convert OpenAI-style payloads to/from the Anthropic
 * Messages API shape.
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

function sse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
    const blocks = [];
    const content = msg.content;
    if (typeof content === 'string') {
      blocks.push({ type: 'text', text: content });
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text') {
          blocks.push({ type: 'text', text: b.text ?? '' });
        } else if (b.type === 'image' && b.source) {
          if (b.source.type === 'base64') {
            blocks.push({
              type: 'image',
              source: { type: 'base64', media_type: b.source.media_type, data: b.source.data },
            });
          } else if (b.source.type === 'url') {
            blocks.push({ type: 'image', source: { type: 'url', url: b.source.url } });
          }
        } else if (b.type === 'thinking' && b.thinking) {
          blocks.push({ type: 'text', text: b.thinking });
        } else if (b.type === 'tool_use') {
          blocks.push({ type: 'text', text: `[tool_use ${b.name ?? ''}] ${JSON.stringify(b.input ?? {})}` });
        } else if (b.type === 'tool_result') {
          const t = typeof b.content === 'string'
            ? b.content
            : Array.isArray(b.content)
              ? b.content.map(x => x?.text ?? '').join('\n')
              : JSON.stringify(b.content ?? '');
          blocks.push({ type: 'text', text: `[tool_result] ${t}` });
        }
      }
    }
    if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
    out.push({ role, content: blocks });
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
 *
 * Block indices: thinking occupies index 0 when present; the text block uses
 * index 0 when there is no thinking block (no index gaps).
 */
export class AnthropicStreamAdapter {
  constructor({ id, model }) {
    this.id = id;
    this.model = model;
    this.started = false;
    this.thinkingOpen = false;
    this.thinkingUsed = false;
    this.textOpen = false;
    this.textIndex = 0;
    this.usage = null;
    this.messageDeltaSent = false;
  }

  get textBlockIndex() {
    return this.thinkingUsed ? 1 : 0;
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
      if (!this.thinkingOpen) {
        this.thinkingOpen = true;
        this.thinkingUsed = true;
        lines.push(sse('content_block_start', {
          type: 'content_block_start', index: 0,
          content_block: { type: 'thinking', thinking: '' },
        }));
      }
      lines.push(sse('content_block_delta', {
        type: 'content_block_delta', index: 0,
        delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
      }));
    }

    if (delta.content) {
      if (this.thinkingOpen) {
        this.thinkingOpen = false;
        lines.push(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
      }
      if (!this.textOpen) {
        this.textOpen = true;
        this.textIndex = this.textBlockIndex;
        lines.push(sse('content_block_start', {
          type: 'content_block_start', index: this.textIndex,
          content_block: { type: 'text', text: '' },
        }));
      }
      lines.push(sse('content_block_delta', {
        type: 'content_block_delta', index: this.textIndex,
        delta: { type: 'text_delta', text: delta.content },
      }));
    }

    if (delta.finish_reason) {
      lines.push(...this.closeBlocks(delta.finish_reason));
    }

    return lines;
  }

  /** Close any open block and emit message_delta exactly once. */
  closeBlocks(finishReason) {
    const lines = [];
    if (this.thinkingOpen) {
      this.thinkingOpen = false;
      lines.push(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
    }
    if (this.textOpen) {
      this.textOpen = false;
      lines.push(sse('content_block_stop', { type: 'content_block_stop', index: this.textIndex }));
    }
    if (!this.messageDeltaSent) {
      this.messageDeltaSent = true;
      lines.push(sse('message_delta', {
        type: 'message_delta',
        delta: {
          stop_reason: STOP_REASON_MAP[finishReason] || 'end_turn',
          stop_sequence: null,
        },
        usage: { output_tokens: this.usage?.completion_tokens ?? 0 },
      }));
    }
    return lines;
  }

  /** Terminal events; call once the upstream stream ends. Safe to call twice. */
  finish(finishReason) {
    const lines = [];
    if (!this.started) {
      // empty response: still emit a structurally valid message
      this.started = true;
      lines.push(sse('message_start', {
        type: 'message_start',
        message: {
          id: this.id, type: 'message', role: 'assistant', model: this.model,
          content: [], stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }));
      lines.push(sse('content_block_start', {
        type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' },
      }));
      this.textOpen = true;
      this.textIndex = 0;
    }
    lines.push(...this.closeBlocks(finishReason));
    if (!this.messageStopSent) {
      this.messageStopSent = true;
      lines.push(sse('message_stop', { type: 'message_stop' }));
    }
    return lines;
  }
}
