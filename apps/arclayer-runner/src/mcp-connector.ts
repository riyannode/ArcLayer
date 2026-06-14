/**
 * ArcLayer MCP Connector — Official SDK Client for Console MCP.
 *
 * Uses @modelcontextprotocol/sdk Client + StreamableHTTPClientTransport.
 * Public API unchanged; internals replaced.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RunnerError } from '@arclayer/runner-core';

export type McpConnectorOptions = {
  baseUrl: string;
  token?: string;
  agentId: string;
  /** Request timeout in ms for SDK client callTool (default: 60_000) */
  requestTimeoutMs?: number;
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
  private readonly requestTimeoutMs: number;
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  private connectPromise?: Promise<void>;
  private closed = false;

  constructor(options: McpConnectorOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.agentId = options.agentId;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
  }

  /**
   * Lazy, concurrency-safe connect.
   * Multiple simultaneous first calls reuse one connectPromise.
   *
   * Uses local variables and only assigns to this.client/this.transport
   * AFTER successful connect. If connect fails, the promise is cleared
   * so the next call retries.
   */
  private async ensureConnected(): Promise<void> {
    if (this.client) return;
    if (this.closed) throw new RunnerError('MCP_ERROR', 'Connector is closed', 500);

    if (!this.connectPromise) {
      this.connectPromise = (async () => {
        const client = new Client({
          name: 'arclayer-runner',
          version: '0.1.4',
        });

        const transport = new StreamableHTTPClientTransport(
          new URL(`${this.baseUrl}/api/mcp`),
          {
            requestInit: {
              headers: this.token
                ? { Authorization: `Bearer ${this.token}` }
                : {},
            },
          },
        );

        try {
          await client.connect(transport);
          // Only assign after successful connect
          this.client = client;
          this.transport = transport;
        } catch (error) {
          // Clean up on failure — allow retry on next call
          await client.close().catch(() => {});
          this.connectPromise = undefined;
          throw error;
        }
      })();
    }

    await this.connectPromise;
  }

  /**
   * Call a Console MCP tool via official SDK.
   *
   * @param timeoutMs - Optional per-call timeout override. Falls back to
   *                    the connector's default requestTimeoutMs.
   */
  async callTool(name: string, args: Record<string, unknown> = {}, timeoutMs?: number): Promise<unknown> {
    await this.ensureConnected();

    const effectiveTimeout = timeoutMs ?? this.requestTimeoutMs;

    try {
      const result = await this.client!.callTool(
        {
          name,
          arguments: {
            agentId: this.agentId,
            ...args,
          },
        },
        undefined, // resultSchema
        { timeout: effectiveTimeout },
      );

      // Handle isError
      if (result.isError) {
        const text = Array.isArray(result.content)
          ? result.content.find((c: any) => c.type === 'text')?.text
          : undefined;
        let errorMessage = 'MCP tool error';
        if (text) {
          try {
            const parsed = JSON.parse(text);
            errorMessage = parsed.message || parsed.error || text;
          } catch {
            errorMessage = text;
          }
        }
        throw new RunnerError('MCP_ERROR', errorMessage, 502);
      }

      // Result parsing priority: structuredContent → JSON text → plain text → full result
      if ('structuredContent' in result && result.structuredContent !== undefined) {
        return result.structuredContent;
      }

      const content = result.content;
      if (Array.isArray(content) && content.length > 0) {
        const textBlock = content.find((c: any) => c.type === 'text');
        if (textBlock?.text) {
          try {
            return JSON.parse(textBlock.text);
          } catch {
            return textBlock.text;
          }
        }
      }

      return result;
    } catch (e) {
      if (e instanceof RunnerError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new RunnerError('MCP_ERROR', `MCP call failed: ${msg}`, 502);
    }
  }

  // ── Identity (Console MCP) ────────────────────────────────────────────

  async prepareRegisterAgent(metadataURI: string): Promise<unknown> {
    return this.callTool('identity.prepare_register_agent', { metadataURI });
  }

  // ── Jobs public (Console MCP) ─────────────────────────────────────────

  async listPublicJobs(filters?: { status?: string; limit?: number }): Promise<unknown> {
    return this.callTool('jobs.list_public', filters ?? {});
  }

  async getPublicJob(jobId: string): Promise<unknown> {
    return this.callTool('jobs.get_public', { jobId });
  }

  // ── Provider Runtime (Console MCP) ────────────────────────────────────

  async heartbeat(): Promise<unknown> {
    return this.callTool('provider.runtime_heartbeat');
  }

  async getRuntimeContext(providerAddress?: string): Promise<unknown> {
    return this.callTool('provider.runtime_get_context', providerAddress ? { providerAddress } : {});
  }

  async getResumePlan(jobId?: string, providerAddress?: string): Promise<unknown> {
    const args: Record<string, unknown> = {};
    if (jobId) args.jobId = jobId;
    if (providerAddress) args.providerAddress = providerAddress;
    return this.callTool('provider.runtime_get_resume_plan', args);
  }

  async startJobRun(jobId: string): Promise<unknown> {
    return this.callTool('provider.runtime_start_job', { jobId });
  }

  async writeCheckpoint(jobId: string, checkpoint: unknown): Promise<unknown> {
    return this.callTool('provider.runtime_write_checkpoint', { jobId, checkpoint });
  }

  /**
   * Complete a hosted MCP run.
   * Only calls Console MCP if runId exists.
   */
  async completeJobRun(jobId: string, result: unknown, runId?: string): Promise<unknown | null> {
    if (!runId) return null;
    return this.callTool('provider.runtime_complete_run', { jobId, result, runId });
  }

  async retryJobRun(jobId: string): Promise<unknown> {
    return this.callTool('provider.runtime_retry_job', { jobId });
  }

  // ── Provider Job Discovery (Console MCP) ──────────────────────────────

  async listOpenJobs(filters?: { limit?: number }): Promise<unknown> {
    return this.callTool('provider.list_open_jobs', filters ?? {});
  }

  async listAssignedJobs(): Promise<unknown> {
    return this.callTool('provider.list_assigned_jobs');
  }

  async applyToOpenJob(jobId: string, capabilities?: string[]): Promise<unknown> {
    return this.callTool('provider.apply_open_job', { jobId, capabilities });
  }

  // ── ERC-8183 Lifecycle (Console MCP — calldata preparation) ───────────

  async prepareSubmitDeliverable(jobId: string, deliverableHash: string): Promise<unknown> {
    return this.callTool('provider.prepare_submit_job', { jobId, deliverableHash });
  }

  async prepareCompleteJob(jobId: string, reason?: string): Promise<unknown> {
    return this.callTool('evaluator.prepare_complete_job', { jobId, reason });
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
    return this.callTool('reputation.give_feedback', input);
  }

  /**
   * Close client and transport. Idempotent — safe to call multiple times.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      await this.client?.close();
    } catch {
      // ignore close errors
    }

    this.client = undefined;
    this.transport = undefined;
    this.connectPromise = undefined;
  }
}
