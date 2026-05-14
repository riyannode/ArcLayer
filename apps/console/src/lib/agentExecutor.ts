/**
 * Agent executor — wraps the 9router LLM gateway.
 *
 * For B1 we use cx/gpt-5.5 hosted at the internal 9router. The executor is a
 * pure function: given (agentId, jobId, input), produce a string output. It
 * does not touch the database or the chain — that's the caller's job.
 *
 * Failure modes:
 *   - Network error → throw, caller marks run as failed
 *   - HTTP non-2xx → throw with status + body preview
 *   - Empty completion → throw 'empty_completion'
 *
 * Timeout: AGENT_TIMEOUT_MS env (default 60s) — hard cap per run.
 */
const ENDPOINT =
  process.env.ARCLAYER_AGENT_ENDPOINT || 'http://43.156.160.127:20128/v1/chat/completions';
const MODEL = process.env.ARCLAYER_AGENT_MODEL || 'cx/gpt-5.5';
const TIMEOUT_MS = Number(process.env.ARCLAYER_AGENT_TIMEOUT_MS || 60_000);
const MAX_TOKENS = Number(process.env.ARCLAYER_AGENT_MAX_TOKENS || 800);

const SYSTEM_PROMPT = `You are an autonomous AI agent on ArcLayer, a decentralized agent
marketplace. A buyer has paid in USDC on the Arc Settlement Vault to invoke
you. Produce a focused, useful response to their task. Be direct, practical,
and cite assumptions when you make them. Do not pretend to have tools you
do not have.`;

export type ExecutorResult = {
  output: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
};

function buildUserPrompt(args: {
  agentId: string;
  jobId: string;
  payer: string;
  input: string;
}): string {
  return [
    `Agent ID: ${args.agentId}`,
    `Job ID: ${args.jobId}`,
    `Buyer: ${args.payer}`,
    '',
    'Task:',
    args.input,
  ].join('\n');
}

export async function runAgent(args: {
  agentId: string;
  jobId: string;
  payer: string;
  input: string;
}): Promise<ExecutorResult> {
  const start = Date.now();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(args) },
        ],
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === 'AbortError') {
      throw new Error(`agent_timeout: exceeded ${TIMEOUT_MS}ms`);
    }
    throw new Error(`agent_network_error: ${(err as Error).message}`);
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const preview = (await resp.text().catch(() => '')).slice(0, 200);
    throw new Error(`agent_http_${resp.status}: ${preview}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
    model?: string;
  };

  const output = data.choices?.[0]?.message?.content?.trim();
  if (!output) throw new Error('agent_empty_completion');

  return {
    output,
    model: data.model || MODEL,
    tokensUsed: data.usage?.total_tokens ?? 0,
    latencyMs: Date.now() - start,
  };
}
