/**
 * ArcLayer MCP Client — JSON-RPC 2.0 client for ArcLayer Global MCP.
 *
 * Handles Bearer auth, tool invocation, and error formatting.
 * No private keys are ever sent through this client.
 */

const DEFAULT_BASE_URL = 'https://arclayers.xyz';

class ArclayerMcpClient {
  constructor(config) {
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.token = config.token;
    this.agentId = config.agentId;
  }

  async callTool(name, args = {}) {
    const body = {
      jsonrpc: '2.0',
      id: `${name}-${Date.now()}`,
      method: 'tools/call',
      params: {
        name,
        arguments: { agentId: this.agentId, ...args },
      },
    };

    const res = await fetch(`${this.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    if (json.error) {
      throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
    }

    // MCP tools/call returns { result: { content: [{ type, text }] } }
    const content = json.result?.content;
    if (Array.isArray(content) && content.length > 0) {
      const textBlock = content.find((c) => c.type === 'text');
      if (textBlock?.text) {
        try {
          return JSON.parse(textBlock.text);
        } catch {
          return textBlock.text;
        }
      }
    }

    return json.result;
  }

  // ── Provider Runtime Tools ──────────────────────────────────────────────

  async heartbeat() {
    return this.callTool('provider.runtime_heartbeat');
  }

  async getContext(providerAddress) {
    return this.callTool('provider.runtime_get_context', providerAddress ? { providerAddress } : {});
  }

  async getResumePlan(jobId, providerAddress) {
    const args = {};
    if (jobId) args.jobId = jobId;
    if (providerAddress) args.providerAddress = providerAddress;
    return this.callTool('provider.runtime_get_resume_plan', args);
  }

  async startJobRun(jobId, phase) {
    return this.callTool('provider.runtime_start_job', { jobId, phase });
  }

  async writeCheckpoint(jobId, checkpoint) {
    return this.callTool('provider.runtime_write_checkpoint', { jobId, ...checkpoint });
  }

  async listOpenJobs(filters = {}) {
    return this.callTool('provider.list_open_jobs', filters);
  }

  async listAssignedJobs(providerAddress, limit) {
    return this.callTool('provider.list_assigned_jobs', { providerAddress, limit: limit || 50 });
  }

  async applyOpenJob(jobId, providerAddress, opts = {}) {
    return this.callTool('provider.apply_open_job', {
      jobId,
      providerAddress,
      ...opts,
    });
  }

  async withdrawApplication(jobId) {
    return this.callTool('provider.withdraw_open_job_application', { jobId });
  }

  async listMyApplications(status) {
    return this.callTool('provider.list_my_open_job_applications', status ? { status } : {});
  }

  async completeRun(jobId, runId) {
    return this.callTool('provider.runtime_complete_run', { jobId, runId });
  }

  // ── ERC-8183 Lifecycle Tools ────────────────────────────────────────────

  async prepareSetBudget(jobId, amountUsdc) {
    return this.callTool('provider.prepare_set_budget_for_session', { jobId, amountUsdc });
  }

  async prepareSubmitJob(jobId, deliverableHash) {
    return this.callTool('provider.prepare_submit_job_for_session', { jobId, deliverableHash });
  }

  async getOnchainStatus(jobId) {
    return this.callTool('jobs.get_onchain_status', { jobId });
  }

  async getJob(jobId) {
    return this.callTool('jobs.get_public', { jobId });
  }
}

module.exports = { ArclayerMcpClient };
