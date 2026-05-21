import { config } from './config.js';

export type LlmResult = { summary: string; output: unknown; proof: unknown };

export class PioneerClient {
  private calls = 0;

  async complete(prompt: string): Promise<LlmResult> {
    if (this.calls >= config.maxLlmCallsPerJob) throw new Error('MAX_LLM_CALLS_PER_JOB exceeded');
    this.calls += 1;
    if (!config.pioneerApiKey || config.dryRun) {
      return { summary: 'dry-run llm response', output: { prompt, dryRun: true }, proof: { provider: config.llmProvider, dryRun: true } };
    }
    const response = await fetch(`${config.pioneerBaseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.pioneerApiKey}` },
      body: JSON.stringify({
        model: config.pioneerModel,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages: [
          { role: 'system', content: 'You are an ArcLayer API-first A2A worker. Return concise JSON with summary, output, and proof.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(`Pioneer API ${response.status}: ${json.error?.message || 'request_failed'}`);
    const content = json.choices?.[0]?.message?.content || '';
    try {
      const parsed = JSON.parse(content);
      return { summary: String(parsed.summary || content.slice(0, 200)), output: parsed.output ?? parsed, proof: parsed.proof ?? { provider: config.llmProvider } };
    } catch {
      return { summary: content.slice(0, 280), output: { text: content }, proof: { provider: config.llmProvider } };
    }
  }

  resetBudget(): void {
    this.calls = 0;
  }
}
