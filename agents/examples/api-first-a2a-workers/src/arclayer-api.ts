import { config } from './config.js';

export type A2AJob = {
  id: string;
  title?: string;
  description?: string;
  category?: string | null;
  role_id?: string | null;
  roleId?: string | null;
  status?: string | null;
  input?: unknown;
  output?: unknown;
  proof?: unknown;
  summary?: string | null;
  is_onchain?: boolean | null;
  onchain_job_id?: string | number | bigint | null;
  deliverable_hash?: string | null;
};

type Query = Record<string, string | number | boolean | undefined | null>;

export class ArcLayerApi {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl = config.arclayerBaseUrl, apiKey = config.arclayerApiKey) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  async listJobs(query: Query = {}): Promise<A2AJob[]> {
    const url = new URL(`${this.baseUrl}/api/a2a/jobs`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    const json = await this.request<{ ok: boolean; jobs?: A2AJob[] }>(url, { method: 'GET', auth: false });
    return json.jobs ?? [];
  }

  async createJob(body: Record<string, unknown>): Promise<A2AJob> {
    const json = await this.request<{ ok: boolean; job: A2AJob }>(`${this.baseUrl}/api/a2a/jobs`, {
      method: 'POST',
      body: JSON.stringify(body),
      auth: false,
    });
    return json.job;
  }

  async claimJob(jobId: string): Promise<unknown> {
    return this.request(`${this.baseUrl}/api/a2a/jobs/${encodeURIComponent(jobId)}/claim`, { method: 'POST', auth: true });
  }

  async submitJob(jobId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request(`${this.baseUrl}/api/a2a/jobs/${encodeURIComponent(jobId)}/submit`, { method: 'POST', body: JSON.stringify(body), auth: true });
  }

  async completeJob(jobId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request(`${this.baseUrl}/api/a2a/jobs/${encodeURIComponent(jobId)}/complete`, { method: 'POST', body: JSON.stringify(body), auth: true });
  }

  private async request<T>(input: string | URL, init: RequestInit & { auth: boolean }): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (init.auth) headers.set('x-arclayer-api-key', this.apiKey);
    const response = await fetch(input, { ...init, headers });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok || json.ok === false) throw new Error(`ArcLayer API ${response.status}: ${json.error || text}`);
    return json as T;
  }
}
