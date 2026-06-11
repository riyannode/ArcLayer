/**
 * ArcLayer MCP Connector — JSON-RPC 2.0 client for existing ArcLayer MCP server.
 *
 * Wraps the existing MCP endpoint (/api/mcp) that already exposes:
 * - identity.prepare_register_agent
 * - jobs.list_public, jobs.get_public
 * - erc8183.* (prepare calldata, read jobs)
 * - provider.runtime_* (heartbeat, context, resume, start, checkpoint, complete, fail)
 *
 * Runner does NOT reimplement MCP tools. It delegates to the existing MCP server
 * and adds policy enforcement, auth, spending limits, and receipt/audit layer.
 */

import { RunnerError } from "@arclayer/runner-core";

export type McpConnectorOptions = {
  baseUrl: string;
  token?: string;
  agentId: string;
};

export type McpToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export class ArcLayerMcpConnector {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly agentId: string;

  constructor(options: McpConnectorOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.agentId = options.agentId;
  }

  /**
   * Call an MCP tool via JSON-RPC 2.0.
   * Same protocol as the existing ArclayerMcpClient used by PM2 bots.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const body = {
      jsonrpc: "2.0",
      id: `${name}-${Date.now()}`,
      method: "tools/call",
      params: {
        name,
        arguments: { agentId: this.agentId, ...args }
      }
    };

    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}/api/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new RunnerError(
        "MCP_ERROR",
        `MCP HTTP ${response.status}: ${text.slice(0, 200)}`,
        502
      );
    }

    const json = await response.json();
    if (json.error) {
      throw new RunnerError(
        "MCP_ERROR",
        `MCP error ${json.error.code}: ${json.error.message}`,
        502
      );
    }

    // MCP tools/call returns { result: { content: [{ type, text }] } }
    const content = json.result?.content;
    if (Array.isArray(content) && content.length > 0) {
      const textBlock = content.find((c: { type: string }) => c.type === "text");
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

  // ── Identity ──────────────────────────────────────────────────────────

  async prepareRegisterAgent(metadataURI: string): Promise<unknown> {
    return this.callTool("identity.prepare_register_agent", { metadataURI });
  }

  // ── Jobs (public) ────────────────────────────────────────────────────

  async listPublicJobs(filters?: { status?: string; limit?: number }): Promise<unknown> {
    return this.callTool("jobs.list_public", filters ?? {});
  }

  async getPublicJob(jobId: string): Promise<unknown> {
    return this.callTool("jobs.get_public", { jobId });
  }

  // ── Provider Runtime ─────────────────────────────────────────────────

  async heartbeat(): Promise<unknown> {
    return this.callTool("provider.runtime_heartbeat");
  }

  async getRuntimeContext(providerAddress?: string): Promise<unknown> {
    return this.callTool("provider.runtime_get_context", providerAddress ? { providerAddress } : {});
  }

  async getResumePlan(jobId?: string, providerAddress?: string): Promise<unknown> {
    const args: Record<string, unknown> = {};
    if (jobId) args.jobId = jobId;
    if (providerAddress) args.providerAddress = providerAddress;
    return this.callTool("provider.runtime_get_resume_plan", args);
  }

  async startJobRun(jobId: string): Promise<unknown> {
    return this.callTool("provider.runtime_start_job", { jobId });
  }

  async writeCheckpoint(jobId: string, checkpoint: unknown): Promise<unknown> {
    return this.callTool("provider.runtime_write_checkpoint", { jobId, checkpoint });
  }

  async completeJobRun(jobId: string, result: unknown, runId?: string): Promise<unknown> {
    return this.callTool("provider.runtime_complete_run", { jobId, result, runId });
  }

  async failJobRun(jobId: string, error: string): Promise<unknown> {
    return this.callTool("provider.runtime_fail_job", { jobId, error });
  }

  async listOpenGlobalJobs(filters?: { limit?: number }): Promise<unknown> {
    return this.callTool("provider.runtime_list_open_jobs", filters ?? {});
  }

  async listAssignedJobs(): Promise<unknown> {
    return this.callTool("provider.runtime_list_assigned_jobs");
  }

  async applyToOpenJob(jobId: string, capabilities?: string[]): Promise<unknown> {
    return this.callTool("provider.runtime_apply_job", { jobId, capabilities });
  }

  // ── ERC-8183 Lifecycle (calldata preparation) ─────────────────────────

  async prepareSubmitDeliverable(jobId: string, deliverableHash: string): Promise<unknown> {
    return this.callTool("provider.prepare_submit_job", { jobId, deliverableHash });
  }

  async prepareCompleteJob(jobId: string, reason?: string): Promise<unknown> {
    return this.callTool("erc8183.prepare_complete", { jobId, reason });
  }

  // ── Reputation ───────────────────────────────────────────────────────

  async giveFeedback(input: {
    agentTokenId: string;
    score: string;
    category: string;
    comment: string;
    metadataURI: string;
    proofURI: string;
    context: string;
    ref: string;
  }): Promise<unknown> {
    return this.callTool("reputation.give_feedback", input);
  }
}
