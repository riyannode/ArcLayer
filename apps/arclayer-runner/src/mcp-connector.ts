/**
 * ArcLayer MCP Connector — JSON-RPC 2.0 client for existing ArcLayer MCP server.
 *
 * Wraps the existing hosted Console MCP endpoint (/api/mcp).
 * Tool names match the Console MCP registry exactly.
 *
 * Runner does NOT reimplement Console MCP tools. It delegates to the existing
 * MCP server and adds policy enforcement, auth, spending limits, and receipt/audit layer.
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
   * Call a Console MCP tool via JSON-RPC 2.0.
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

  // ── Identity (Console MCP) ────────────────────────────────────────────

  async prepareRegisterAgent(metadataURI: string): Promise<unknown> {
    return this.callTool("identity.prepare_register_agent", { metadataURI });
  }

  // ── Jobs public (Console MCP) ─────────────────────────────────────────

  async listPublicJobs(filters?: { status?: string; limit?: number }): Promise<unknown> {
    return this.callTool("jobs.list_public", filters ?? {});
  }

  async getPublicJob(jobId: string): Promise<unknown> {
    return this.callTool("jobs.get_public", { jobId });
  }

  // ── Provider Runtime (Console MCP) ────────────────────────────────────

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

  /**
   * Complete a hosted MCP run.
   * Only calls Console MCP if runId exists (returned by startJobRun).
   * If runId is missing, skips hosted completion — caller stores local receipt.
   */
  async completeJobRun(jobId: string, result: unknown, runId?: string): Promise<unknown | null> {
    if (!runId) {
      // No runId — hosted MCP run was never started or start failed.
      // Do not call complete_run without a real runId.
      return null;
    }
    return this.callTool("provider.runtime_complete_run", { jobId, result, runId });
  }

  /**
   * Retry a hosted MCP run.
   */
  async retryJobRun(jobId: string): Promise<unknown> {
    return this.callTool("provider.runtime_retry_job", { jobId });
  }

  // ── Provider Job Discovery (Console MCP — valid names) ────────────────

  async listOpenJobs(filters?: { limit?: number }): Promise<unknown> {
    return this.callTool("provider.list_open_jobs", filters ?? {});
  }

  async listAssignedJobs(): Promise<unknown> {
    return this.callTool("provider.list_assigned_jobs");
  }

  async applyToOpenJob(jobId: string, capabilities?: string[]): Promise<unknown> {
    return this.callTool("provider.apply_open_job", { jobId, capabilities });
  }

  // ── ERC-8183 Lifecycle (Console MCP — calldata preparation) ───────────

  async prepareSubmitDeliverable(jobId: string, deliverableHash: string): Promise<unknown> {
    return this.callTool("provider.prepare_submit_job", { jobId, deliverableHash });
  }

  async prepareCompleteJob(jobId: string, reason?: string): Promise<unknown> {
    return this.callTool("evaluator.prepare_complete_job", { jobId, reason });
  }

  // ── Reputation (Console MCP) ──────────────────────────────────────────

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
