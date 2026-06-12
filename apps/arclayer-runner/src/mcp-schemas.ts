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
  },

  // ── ERC-8183 Full Lifecycle (runner-local) ──────────────────────────────
  {
    name: "erc8183.create_job",
    description: "Create ERC-8183 job on-chain via Circle CLI. hook is an address (not bytes).",
    inputSchema: {
      provider: { type: "string", required: true, description: "Provider wallet address" },
      evaluator: { type: "string", required: true, description: "Evaluator wallet address" },
      expiredAt: { type: "string", required: true, description: "Job expiry as unix timestamp" },
      description: { type: "string", required: true, description: "Job description" },
      hook: { type: "string", description: "Callback contract address (default: zero address)" }
    }
  },
  {
    name: "erc8183.set_budget",
    description: "Set budget for an ERC-8183 job",
    inputSchema: {
      jobId: { type: "string", required: true },
      amount: { type: "string", required: true, description: "Budget amount in USDC (6 decimals)" },
      optParams: { type: "string", description: "Optional params bytes (default: 0x)" }
    }
  },
  {
    name: "erc8183.approve_usdc",
    description: "Approve USDC for ERC-8183 AgenticCommerce contract. Must be called before fund_job.",
    inputSchema: {
      amount: { type: "string", required: true, description: "Amount to approve in USDC (6 decimals)" }
    }
  },
  {
    name: "erc8183.fund_job",
    description: "Fund an ERC-8183 job. Requires prior approve_usdc.",
    inputSchema: {
      jobId: { type: "string", required: true },
      optParams: { type: "string", description: "Optional params bytes (default: 0x)" }
    }
  },
  {
    name: "erc8183.complete_job",
    description: "Complete an ERC-8183 job (evaluator action). reason is bytes32 or string (auto-hashed).",
    inputSchema: {
      jobId: { type: "string", required: true },
      reason: { type: "string", required: true, description: "bytes32 hash or plaintext string" },
      optParams: { type: "string", description: "Optional params bytes (default: 0x)" }
    }
  },
  {
    name: "erc8183.reject_job",
    description: "Reject an ERC-8183 job (evaluator action). reason is bytes32 or string (auto-hashed).",
    inputSchema: {
      jobId: { type: "string", required: true },
      reason: { type: "string", required: true, description: "bytes32 hash or plaintext string" },
      optParams: { type: "string", description: "Optional params bytes (default: 0x)" }
    }
  },

  // ── ERC-8004 Register via Circle CLI ────────────────────────────────────
  {
    name: "erc8004.register_via_circle_cli",
    description: "Register ERC-8004 identity on-chain via Circle CLI. Gated behind allowIdentityRegister.",
    inputSchema: {
      metadataURI: { type: "string", required: true, description: "Agent manifest URL" }
    }
  },

  // ── Gateway Deposit ─────────────────────────────────────────────────────
  {
    name: "circle.gateway_deposit",
    description: "Deposit USDC into Circle Gateway. Gated behind allowGatewayDeposit. devops-admin only.",
    inputSchema: {
      amount: { type: "string", required: true, description: "Amount in USDC" },
      method: { type: "string", description: "Deposit method: eco (fast, no gas) or direct (on-chain)" }
    }
  },

  // ── Skill Context Tools (Phase 3) ────────────────────────────────────
  {
    name: "runner.skills_list",
    description: "List all manifest skills with id, title, path, exists, sha256, roles, status"
  },
  {
    name: "runner.skill_get",
    description: "Get skill content by ID (content, sha256, path, roles, capabilities)",
    inputSchema: {
      skillId: { type: "string", required: true, description: "Skill ID from manifest" }
    }
  },
  {
    name: "runner.skills_bundle",
    description: "Bundle skills for a role or list of skill IDs (context only)",
    inputSchema: {
      role: { type: "string", description: "Role name (e.g. provider, client, evaluator)" },
      skillIds: { type: "array", items: { type: "string" }, description: "Specific skill IDs to bundle" }
    }
  },
  {
    name: "runner.role_profile",
    description: "Role description, capabilities, tool groups, recommended setup",
    inputSchema: {
      role: { type: "string", required: true, description: "Role name" }
    }
  },
  {
    name: "runner.role_tools",
    description: "Callable tools enabled for a role",
    inputSchema: {
      role: { type: "string", required: true, description: "Role name" }
    }
  }
];
