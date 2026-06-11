/**
 * Runner-local MCP tool schemas.
 * JSON-RPC 2.0 compatible input/output definitions.
 */

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
};

export const RUNNER_MCP_TOOLS: McpToolDef[] = [
  // ── Runner introspection ──────────────────────────────────────────────
  {
    name: "runner.health",
    description: "Runner health check"
  },
  {
    name: "runner.manifest",
    description: "Runner manifest with capabilities"
  },
  {
    name: "runner.skill",
    description: "Global Agent Skill content and hash"
  },
  {
    name: "runner.receipts",
    description: "Recent receipts",
    inputSchema: { limit: { type: "number", description: "Max receipts (1-500)" } }
  },
  {
    name: "runner.ledger",
    description: "Recent spending ledger records",
    inputSchema: { limit: { type: "number", description: "Max records (1-500)" } }
  },
  {
    name: "runner.policy",
    description: "Current spending policy limits"
  },

  // ── Circle CLI ────────────────────────────────────────────────────────
  {
    name: "circle.status",
    description: "Circle CLI version, wallet status, gateway balance"
  },
  {
    name: "circle.gateway_balance",
    description: "Gateway balance for configured wallet"
  },
  {
    name: "circle.wallet_balance",
    description: "Wallet balance for configured wallet"
  },
  {
    name: "circle.wallet_budget",
    description: "Wallet budget/limit for configured wallet"
  },
  {
    name: "circle.wallet_policy_status",
    description: "Compare Runner policy vs Circle wallet policy caps + remaining budget"
  },

  // ── x402 ──────────────────────────────────────────────────────────────
  {
    name: "x402.inspect",
    description: "Inspect x402 service (read-only, no payment)",
    inputSchema: {
      url: { type: "string", required: true },
      method: { type: "string" },
      body: { type: "object" }
    }
  },
  {
    name: "x402.pay",
    description: "Pay x402 service (requires paymentEnabled + wallet)",
    inputSchema: {
      url: { type: "string", required: true },
      method: { type: "string" },
      maxAmountUsdc: { type: "string", required: true },
      reason: { type: "string", required: true },
      idempotencyKey: { type: "string" },
      body: { type: "object" }
    }
  },
  {
    name: "x402.batch_pay",
    description: "Batch pay multiple x402 services",
    inputSchema: {
      batchId: { type: "string", required: true },
      taskId: { type: "string", required: true },
      payments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            method: { type: "string" },
            maxAmountUsdc: { type: "string" },
            reason: { type: "string" },
            idempotencyKey: { type: "string" }
          }
        },
        minItems: 1
      }
    }
  },
  {
    name: "x402.list_receipts",
    description: "List x402 payment receipts",
    inputSchema: { limit: { type: "number" } }
  },
  {
    name: "x402.payment_policy",
    description: "Current x402 payment policy (limits, hosts, enabled)"
  },

  // ── ERC-8004 ──────────────────────────────────────────────────────────
  {
    name: "erc8004.prepare_register",
    description: "Prepare ERC-8004 agent registration (unsigned calldata)",
    inputSchema: {
      metadataURI: { type: "string", required: true, description: "Agent manifest URL" }
    }
  },

  // ── ERC-8183 ──────────────────────────────────────────────────────────
  {
    name: "erc8183.provider_run_job",
    description: "Dispatch job to LLM runtime (no on-chain submit)",
    inputSchema: {
      taskId: { type: "string", required: true },
      jobId: { type: "string", required: true },
      agentId: { type: "string", required: true },
      provider: { type: "string", required: true },
      description: { type: "string", required: true },
      input: { type: "object", required: true }
    }
  },
  {
    name: "erc8183.provider_submit_deliverable",
    description: "Submit deliverable on-chain via Circle CLI",
    inputSchema: {
      jobId: { type: "string", required: true },
      deliverableHash: { type: "string", required: true }
    }
  },
  {
    name: "erc8183.provider_run_and_submit",
    description: "Run job + submit deliverable (full lifecycle)",
    inputSchema: {
      taskId: { type: "string", required: true },
      jobId: { type: "string", required: true },
      agentId: { type: "string", required: true },
      provider: { type: "string", required: true },
      description: { type: "string", required: true },
      input: { type: "object", required: true }
    }
  },
  {
    name: "erc8183.provider_runtime_status",
    description: "Provider runtime context from hosted MCP"
  }
];
