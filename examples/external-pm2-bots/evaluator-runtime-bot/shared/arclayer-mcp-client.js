/**
 * ArcLayer MCP Client — JSON-RPC 2.0 client for ArcLayer Global MCP.
 *
 * Evaluator variant: extends base pattern with evaluator-specific methods.
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

  // ── Job Discovery ─────────────────────────────────────────────────────

  /**
   * List jobs filtered by evaluator address and status.
   * Uses jobs.list_public with evaluatorAddress filter.
   *
   * @param {string} evaluatorAddress
   * @param {string} status - 'submitted' | 'funded' | 'created' | 'completed'
   * @param {number} limit
   * @returns {Promise<{ jobs: Array, total: number }>}
   */
  async listEvaluatorJobs(evaluatorAddress, status = 'submitted', limit = 50) {
    return this.callTool('jobs.list_public', {
      status,
      evaluatorAddress,
      limit,
    });
  }

  /**
   * Get a single job by jobId from the indexer.
   * @param {string} jobId
   * @returns {Promise<Object>}
   */
  async getJob(jobId) {
    return this.callTool('jobs.get_public', { jobId });
  }

  /**
   * Get on-chain job status via contract read.
   * @param {string} jobId
   * @returns {Promise<Object>}
   */
  async getOnchainJob(jobId) {
    return this.callTool('jobs.get_onchain_status', { jobId });
  }

  // ── Evaluator Lifecycle Tools ─────────────────────────────────────────

  /**
   * Prepare complete() calldata for an ERC-8183 job.
   * Returns { to, data, value } for signing.
   *
   * @param {string} jobId
   * @param {string} reason - reason string (will be keccak256-hashed) or 0x bytes32
   * @returns {Promise<Object>} tx instruction
   */
  async prepareCompleteJob(jobId, reason) {
    return this.callTool('evaluator.prepare_complete_job', {
      jobId,
      reason: reason || 'approved',
    });
  }

  /**
   * Prepare reject() calldata for an ERC-8183 job.
   * Returns { to, data, value } for signing.
   *
   * @param {string} jobId
   * @param {string} reason
   * @returns {Promise<Object>} tx instruction
   */
  async prepareRejectJob(jobId, reason) {
    return this.callTool('evaluator.prepare_reject_job', {
      jobId,
      reason: reason || 'rejected',
    });
  }
}

module.exports = { ArclayerMcpClient };
