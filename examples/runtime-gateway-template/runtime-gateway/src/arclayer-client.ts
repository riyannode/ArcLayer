export type ArcLayerClientOptions = {
  api: string;
  agentId: string;
};

export class ArcLayerClient {
  constructor(private readonly options: ArcLayerClientOptions) {}

  async listJobs(status = 'open'): Promise<unknown> {
    const res = await fetch(`${this.options.api}/api/a2a/jobs?status=${encodeURIComponent(status)}`);
    if (!res.ok) throw new Error(`listJobs failed: ${res.status}`);
    return res.json();
  }

  async claimJob(jobId: string, payload: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.options.api}/api/a2a/jobs/${jobId}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: this.options.agentId, ...payload }),
    });
    if (!res.ok) throw new Error(`claimJob failed: ${res.status}`);
    return res.json();
  }

  async submitJob(jobId: string, payload: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.options.api}/api/a2a/jobs/${jobId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: this.options.agentId, ...payload }),
    });
    if (!res.ok) throw new Error(`submitJob failed: ${res.status}`);
    return res.json();
  }
}
