/**
 * openai-format.js — OpenAI Chat Completions <-> qwenwork infer format
 *
 * qwenwork messages use Anthropic-style content blocks:
 *   { role: 'system'|'user'|'assistant', content: [{ type: 'text', text }] }
 */

/** OpenAI messages -> qwenwork messages */
export function openaiToQwenworkMessages(messages) {
  const out = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const role = msg.role;
    if (role === 'system' || role === 'developer') {
      out.push({ role: 'system', content: [{ type: 'text', text: contentToText(msg.content) }] });
    } else if (role === 'user') {
      const blocks = [];
      if (typeof msg.content === 'string') {
        blocks.push({ type: 'text', text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part?.type === 'text') blocks.push({ type: 'text', text: part.text ?? '' });
          else if (part?.type === 'image_url' && part?.image_url?.url) {
            blocks.push(imageUrlToQwenwork(part.image_url.url));
          }
        }
      }
      if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
      out.push({ role: 'user', content: blocks });
    } else if (role === 'assistant') {
      const text = contentToText(msg.content);
      out.push({ role: 'assistant', content: [{ type: 'text', text }] });
    } else if (role === 'tool') {
      // merge tool results into a user turn so the model sees them
      out.push({ role: 'user', content: [{ type: 'text', text: `[tool result] ${contentToText(msg.content)}` }] });
    }
  }
  return out;
}

function imageUrlToQwenwork(url) {
  // data: URL -> { type: 'image', source: { type: 'base64', ... } }
  const m = /^data:([^;]+);base64,(.+)$/.exec(url || '');
  if (m) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: m[1], data: m[2] },
    };
  }
  // remote URL: pass through in the upstream's expected shape
  return { type: 'image', source: { type: 'url', url } };
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(p => p?.text ?? '').join('\n');
  }
  return '';
}

/** Shape an OpenAI non-stream response from accumulated parts. */
export function buildOpenAIResponse({ id, model, content, reasoning, usage, finishReason }) {
  const message = { role: 'assistant', content };
  if (reasoning) message.reasoning_content = reasoning;
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason || 'stop' }],
    usage: usage ? {
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    } : undefined,
  };
}

/** Shape one OpenAI stream chunk. finish_reason belongs to the choice, not the delta. */
export function buildOpenAIStreamChunk({ id, model, delta, finishReason = null }) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: delta ?? {}, finish_reason: finishReason }],
  };
}
