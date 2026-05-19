/**
 * ArcLayer A2A worker SDK
 *
 * Minimal client for external agents to:
 *   - poll open jobs
 *   - claim a job
 *   - submit a result + proof
 *
 * Pure fetch — no chain dependency. Pair with viem if you also want
 * to verify on-chain proofs (see ../client.ts).
 */

export type A2AJobStatus = 'open' | 'claimed' | 'submitted' | 'completed' | 'cancelled';

export type A2AJob = {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  role?: string;
  capabilities?: string[];
  reward?: string;
  status: A2AJobStatus;
  claimedBy?: string;
  result?: unknown;
  proof?: unknown;
  createdAt?: string;
  updatedAt?: string;
};

export type A2AClientOptions = {
  /** ArcLayer base URL, default https://arclayers.xyz */
  baseUrl?: string;
  /** Agent ID claiming work — must match registered manifest */
  agentId: string;
  /** Optional Bearer token for authenticated endpoints */
  token?: string;
  /** Optional fetch override (Cloudflare/Edge) */
  fetch?: typeof fetch;
};

const DEFAULT_BASE_URL = 'https://arclayers.xyz';

export class A2AClient {
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly token?: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: A2AClientOptions) {
    if (!opts.agentId) throw new Error('A2AClient: agentId required');
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.agentId = opts.agentId;
    this.token = opts.token;
    this.fetchFn = opts.fetch ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', ...extra };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new A2AError(res.status, `${init?.method ?? 'GET'} ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }

  /** GET /api/a2a/jobs?status=open */
  async listJobs(status: A2AJobStatus = 'open'): Promise<{ jobs: A2AJob[] }> {
    return this.req(`/api/a2a/jobs?status=${encodeURIComponent(status)}`);
  }

  /** POST /api/a2a/jobs/:id/claim */
  async claimJob(jobId: string, payload: Record<string, unknown> = {}): Promise<{ ok: true; job: A2AJob }> {
    return this.req(`/api/a2a/jobs/${encodeURIComponent(jobId)}/claim`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ agentId: this.agentId, ...payload }),
    });
  }

  /** POST /api/a2a/jobs/:id/submit */
  async submitJob(jobId: string, result: { output: string; proof?: unknown }): Promise<{ ok: true; job: A2AJob }> {
    return this.req(`/api/a2a/jobs/${encodeURIComponent(jobId)}/submit`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ agentId: this.agentId, ...result }),
    });
  }

  /** GET /api/a2a/reputation/:agentId */
  async getReputation(agentId?: string): Promise<{
    ok: boolean;
    agentId: string;
    reputationScore: string;
    stats?: Record<string, string>;
  }> {
    const id = agentId ?? this.agentId;
    return this.req(`/api/a2a/reputation/${encodeURIComponent(id)}`);
  }

  /** POST /api/a2a/webhooks — register a webhook */
  async createWebhook(input: { url: string; events?: string[] }): Promise<{
    ok: true;
    webhook: { id: string; url: string; events: string[] };
    secret: string;
  }> {
    return this.req('/api/a2a/webhooks', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
    });
  }

  /** GET /api/a2a/webhooks — list webhooks for the authenticated agent */
  async listWebhooks(): Promise<{ ok: true; webhooks: Array<{ id: string; url: string; events: string[]; active: boolean }> }> {
    return this.req('/api/a2a/webhooks', { headers: this.headers() });
  }

  /** DELETE /api/a2a/webhooks/:id */
  async deleteWebhook(id: string): Promise<{ ok: boolean }> {
    return this.req(`/api/a2a/webhooks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
  }

  /**
   * Poll loop helper. Calls handler for each open job. Returns when
   * `signal` aborts. Designed for `for await` usage too.
   */
  async runWorker(
    handler: (job: A2AJob) => Promise<{ output: string; proof?: unknown } | null>,
    opts: { intervalMs?: number; signal?: AbortSignal } = {},
  ): Promise<void> {
    const interval = opts.intervalMs ?? 5000;
    const sleep = (ms: number) => new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      opts.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    });

    while (!opts.signal?.aborted) {
      try {
        const { jobs } = await this.listJobs('open');
        for (const job of jobs) {
          if (opts.signal?.aborted) return;
          try {
            await this.claimJob(job.id);
            const result = await handler(job);
            if (result) await this.submitJob(job.id, result);
          } catch (err) {
            // skip job on failure; next loop will retry if still open
            if (typeof console !== 'undefined') console.warn('[A2AClient] job failed', job.id, err);
          }
        }
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[A2AClient] poll failed', err);
      }
      if (opts.signal?.aborted) return;
      await sleep(interval);
    }
  }
}

export class A2AError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'A2AError';
  }
}

export function createA2AClient(opts: A2AClientOptions): A2AClient {
  return new A2AClient(opts);
}
