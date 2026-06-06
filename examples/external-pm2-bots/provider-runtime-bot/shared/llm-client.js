/**
 * LLM Client — OpenAI-compatible /v1/chat/completions wrapper.
 *
 * Minimal, no streaming, no retries, no function calling.
 * Timeout via AbortController. Safe errors only.
 * Never logs API keys.
 */

/**
 * Call an OpenAI-compatible chat completions endpoint.
 *
 * @param {Object} opts
 * @param {string} opts.baseUrl - e.g. "https://api.blockchain.info/ai/api/v1"
 * @param {string} opts.apiKey  - Bearer token (never logged)
 * @param {string} opts.model   - e.g. "deepseek/deepseek-v4-flash"
 * @param {Array}  opts.messages - OpenAI message array [{role, content}]
 * @param {number} [opts.maxTokens=2500]
 * @param {number} [opts.temperature=0.2]
 * @param {number} [opts.timeoutMs=60000]
 * @returns {Promise<string>} - raw content string from the model
 */
async function callLLM({
  baseUrl,
  apiKey,
  model,
  messages,
  maxTokens = 2500,
  temperature = 0.2,
  timeoutMs = 60000,
}) {
  if (!baseUrl) throw new Error('LLM_BASE_URL is required');
  if (!model) throw new Error('LLM_MODEL is required');
  if (!messages || !messages.length) throw new Error('messages array is required');
  // apiKey may be empty for local/no-auth providers — omit Authorization header in that case

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`LLM timeout after ${timeoutMs}ms`);
    }
    throw new Error(`LLM request failed: ${err.message}`);
  }

  clearTimeout(timer);

  if (!res.ok) {
    // Read body for error context, but never include auth headers
    let detail = '';
    try {
      const errBody = await res.json().catch(() => null);
      detail = errBody?.error?.message || errBody?.error || '';
    } catch { /* ignore */ }
    throw new Error(`LLM HTTP ${res.status}${detail ? ': ' + detail : ''}`);
  }

  const json = await res.json().catch(() => null);
  if (!json) throw new Error('LLM returned invalid JSON');

  const content = json.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('LLM returned empty or missing content');
  }

  return content;
}

/**
 * Call LLM and parse response as JSON.
 * Strips markdown fences if present.
 *
 * @returns {Promise<Object>} - parsed JSON object
 */
async function callLLMJson(opts) {
  const raw = await callLLM(opts);

  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    // Remove opening fence (with optional language tag)
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
    // Remove closing fence
    cleaned = cleaned.replace(/\n?```\s*$/, '');
    cleaned = cleaned.trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`LLM response is not valid JSON: ${err.message}`);
  }
}

module.exports = { callLLM, callLLMJson };
