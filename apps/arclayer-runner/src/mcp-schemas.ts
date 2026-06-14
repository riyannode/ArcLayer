/**
 * Runner-local MCP tool schemas.
 * JSON-RPC 2.0 compatible input/output definitions.
 *
 * For write/payment tools, inputSchema is derived from runner-core Zod schemas
 * via zodInputSchemaToJsonSchema() — ensuring tools/list and execution validation
 * always agree on the schema contract.
 *
 * Read-only introspection tools keep hand-written schemas (trivial shape).
 */

import { zodInputSchemaToJsonSchema } from "@arclayer/runner-core";
import {
  X402InspectInputSchema,
  X402PayInputSchema,
  X402BatchPayInputSchema,
  Erc8004PrepareRegisterInputSchema,
  Erc8004RegisterViaCircleCliInputSchema,
  Erc8183ProviderRunJobInputSchema,
  Erc8183ProviderSubmitDeliverableInputSchema,
  Erc8183ProviderRunAndSubmitInputSchema,
  Erc8183CreateJobInputSchema,
  Erc8183SetBudgetInputSchema,
  Erc8183ApproveUsdcInputSchema,
  Erc8183FundJobInputSchema,
  Erc8183CompleteJobInputSchema,
  Erc8183RejectJobInputSchema,
  Erc8183ClaimRefundInputSchema,
  Erc8183SetProviderInputSchema,
  CircleGatewayDepositInputSchema,
} from "@arclayer/runner-core";

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
};

// ── Helper: derive inputSchema from Zod, add description overrides ────────

/**
 * Build an MCP-compatible inputSchema from a Zod schema,
 * merging in field-level descriptions from a overrides map.
 */
function fromZod(
  schema: Parameters<typeof zodInputSchemaToJsonSchema>[0],
  descriptionOverrides?: Record<string, string>
): Record<string, unknown> | undefined {
  const base = zodInputSchemaToJsonSchema(schema);
  if (!base || !descriptionOverrides) return base ?? undefined;

  // Merge descriptions into the schema
  for (const [field, description] of Object.entries(descriptionOverrides)) {
    if (base[field] && typeof base[field] === "object") {
      (base[field] as Record<string, unknown>).description = description;
    }
  }
  return base;
}

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
  {
    name: "runner.list_reconcilable_operations",
    description: "List operations needing reconciliation (broadcast/unknown). Operator/admin only."
  },
  {
    name: "runner.reconcile_operation",
    description: "Reconcile a broadcast/unknown operation to confirmed or failed. Operator/admin only.",
    inputSchema: {
      operationId: { type: "string", description: "Operation ID to reconcile" },
      outcome: { type: "string", enum: ["confirmed", "failed", "unknown"], description: "Reconciliation outcome" },
      txHash: { type: "string", description: "Transaction hash (for confirmed outcome)" },
      errorCode: { type: "string", description: "Error code (for failed outcome)" },
      errorMessage: { type: "string", description: "Error message (for failed outcome)" }
    }
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
    inputSchema: fromZod(X402InspectInputSchema, {
      url: "x402 service URL",
      method: "HTTP method (default: GET)",
      body: "Request body (optional)",
    })
  },
  {
    name: "x402.pay",
    description: "Pay x402 service (requires paymentEnabled + wallet)",
    inputSchema: fromZod(X402PayInputSchema, {
      url: "x402 service URL",
      method: "HTTP method (default: GET)",
      maxAmountUsdc: "Max payment amount in USDC",
      reason: "Payment reason (for audit)",
      idempotencyKey: "Idempotency key (optional, auto-generated if missing)",
      body: "Request body (optional)",
    })
  },
  {
    name: "x402.batch_pay",
    description: "Batch pay multiple x402 services",
    inputSchema: fromZod(X402BatchPayInputSchema, {
      batchId: "Batch identifier",
      taskId: "Task identifier",
      payments: "Array of payment requests",
    })
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
    inputSchema: fromZod(Erc8004PrepareRegisterInputSchema, {
      metadataURI: "Agent manifest URL",
    })
  },

  // ── ERC-8183 ──────────────────────────────────────────────────────────
  {
    name: "erc8183.provider_run_job",
    description: "Dispatch job to LLM runtime (no on-chain submit)",
    inputSchema: fromZod(Erc8183ProviderRunJobInputSchema, {
      taskId: "Task identifier",
      jobId: "ERC-8183 job ID (numeric string)",
      agentId: "Agent identifier",
      provider: "Provider wallet address (0x...)",
      description: "Job description",
      input: "Job input payload",
    })
  },
  {
    name: "erc8183.provider_submit_deliverable",
    description: "Submit deliverable on-chain via Circle CLI",
    inputSchema: fromZod(Erc8183ProviderSubmitDeliverableInputSchema, {
      jobId: "ERC-8183 job ID (numeric string)",
      deliverableHash: "Deliverable hash (bytes32)",
    })
  },
  {
    name: "erc8183.provider_run_and_submit",
    description: "Run job + submit deliverable (full lifecycle)",
    inputSchema: fromZod(Erc8183ProviderRunAndSubmitInputSchema, {
      taskId: "Task identifier",
      jobId: "ERC-8183 job ID (numeric string)",
      agentId: "Agent identifier",
      provider: "Provider wallet address (0x...)",
      description: "Job description",
      input: "Job input payload",
    })
  },
  {
    name: "erc8183.provider_runtime_status",
    description: "Provider runtime context from hosted MCP"
  },

  // ── ERC-8183 Full Lifecycle (runner-local) ──────────────────────────────
  {
    name: "erc8183.create_job",
    description: "Create ERC-8183 job on-chain via Circle CLI. hook is an address (not bytes).",
    inputSchema: fromZod(Erc8183CreateJobInputSchema, {
      provider: "Provider wallet address",
      evaluator: "Evaluator wallet address",
      expiredAt: "Job expiry as unix timestamp",
      description: "Job description",
      hook: "Callback contract address (default: zero address)",
    })
  },
  {
    name: "erc8183.set_budget",
    description: "Set budget for an ERC-8183 job",
    inputSchema: fromZod(Erc8183SetBudgetInputSchema, {
      jobId: "ERC-8183 job ID (numeric string)",
      amount: "Budget amount in USDC (6 decimals)",
      optParams: "Optional params bytes (default: 0x)",
    })
  },
  {
    name: "erc8183.approve_usdc",
    description: "Approve USDC for ERC-8183 AgenticCommerce contract. Must be called before fund_job.",
    inputSchema: fromZod(Erc8183ApproveUsdcInputSchema, {
      amount: "Amount to approve in USDC (6 decimals)",
    })
  },
  {
    name: "erc8183.fund_job",
    description: "Fund an ERC-8183 job. Requires prior approve_usdc.",
    inputSchema: fromZod(Erc8183FundJobInputSchema, {
      jobId: "ERC-8183 job ID (numeric string)",
      optParams: "Optional params bytes (default: 0x)",
    })
  },
  {
    name: "erc8183.complete_job",
    description: "Complete an ERC-8183 job (evaluator action). reason is bytes32 or string (auto-hashed).",
    inputSchema: fromZod(Erc8183CompleteJobInputSchema, {
      jobId: "ERC-8183 job ID (numeric string)",
      reason: "bytes32 hash or plaintext string",
      optParams: "Optional params bytes (default: 0x)",
    })
  },
  {
    name: "erc8183.reject_job",
    description: "Reject an ERC-8183 job (evaluator action). reason is bytes32 or string (auto-hashed).",
    inputSchema: fromZod(Erc8183RejectJobInputSchema, {
      jobId: "ERC-8183 job ID (numeric string)",
      reason: "bytes32 hash or plaintext string",
      optParams: "Optional params bytes (default: 0x)",
    })
  },
  {
    name: "erc8183.claim_refund",
    description: "Claim refund for an expired ERC-8183 job (client action). Single arg — no optParams.",
    inputSchema: fromZod(Erc8183ClaimRefundInputSchema, {
      jobId: "ERC-8183 job ID (numeric string)",
    })
  },
  {
    name: "erc8183.set_provider",
    description: "Assign provider to an open ERC-8183 job (client action). Job must be Open, provider must be 0x0.",
    inputSchema: fromZod(Erc8183SetProviderInputSchema, {
      jobId: "ERC-8183 job ID (numeric string)",
      provider: "Provider wallet address (0x...)",
    })
  },

  // ── ERC-8004 Register via Circle CLI ────────────────────────────────────
  {
    name: "erc8004.register_via_circle_cli",
    description: "Register ERC-8004 identity on-chain via Circle CLI. Gated behind allowIdentityRegister.",
    inputSchema: fromZod(Erc8004RegisterViaCircleCliInputSchema, {
      metadataURI: "Agent manifest URL",
    })
  },

  // ── Gateway Deposit ─────────────────────────────────────────────────────
  {
    name: "circle.gateway_deposit",
    description: "Deposit USDC into Circle Gateway. Gated behind allowGatewayDeposit. devops-admin only.",
    inputSchema: fromZod(CircleGatewayDepositInputSchema, {
      amount: "Amount in USDC",
      method: "Deposit method: eco (fast, no gas) or direct (on-chain)",
    })
  },

  // ── MCP Tool Broker Introspection (PR #3) ─────────────────────────────
  {
    name: "runner.broker_status",
    description: "MCP Tool Broker session state: call count, total cost, budget limits"
  },
  {
    name: "runner.audit_log",
    description: "MCP Tool Broker audit log — all tool calls with timing, cost, errors",
    inputSchema: {
      limit: { type: "number", description: "Max entries to return (default: 50)" }
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

// ── Console MCP Proxy Tool Schemas ─────────────────────────────────────────
// These are proxied to Console MCP. Input schemas define the shape visible
// in tools/list; actual validation happens on the Console side.

export const CONSOLE_PROXY_MCP_TOOLS: McpToolDef[] = [
  // Identity
  { name: "identity.prepare_register_agent", description: "ERC-8004 register() calldata via Console MCP", inputSchema: { metadataURI: { type: "string", required: true, description: "Agent manifest URL" } } },
  { name: "identity.prepare_register_agent_for_session", description: "Session-bound register via Console MCP", inputSchema: { metadataURI: { type: "string", required: true, description: "Agent manifest URL" } } },
  { name: "identity.request_register_agent_approval", description: "Approval URL for registration", inputSchema: { metadataURI: { type: "string", required: true, description: "Agent manifest URL" } } },
  { name: "identity.get_registration_status", description: "Check registration status" },
  { name: "identity.get_agent_account", description: "Get agent account details" },

  // Reputation
  { name: "reputation.give_feedback", description: "Submit reputation feedback", inputSchema: { agentTokenId: { type: "string", required: true }, score: { type: "string", required: true }, category: { type: "string", required: true }, comment: { type: "string" }, metadataURI: { type: "string" }, proofURI: { type: "string" }, context: { type: "string" }, ref: { type: "string" } } },

  // Validation
  { name: "validation.request_calldata", description: "Request validation calldata" },
  { name: "validation.response_calldata", description: "Response validation calldata" },
  { name: "validation.status_read", description: "Read validation status" },

  // Jobs
  { name: "jobs.list_public", description: "List public jobs", inputSchema: { status: { type: "string" }, limit: { type: "number" } } },
  { name: "jobs.get_public", description: "Get job details", inputSchema: { jobId: { type: "string", required: true, description: "Job ID" } } },
  { name: "jobs.get_onchain_status", description: "On-chain job status", inputSchema: { jobId: { type: "string", required: true } } },
  { name: "jobs.get_lifecycle_summary", description: "Job lifecycle summary", inputSchema: { jobId: { type: "string", required: true } } },

  // Client
  { name: "client.prepare_create_job", description: "Create job calldata", inputSchema: { provider: { type: "string", required: true }, evaluator: { type: "string", required: true }, expiredAt: { type: "string", required: true }, description: { type: "string", required: true }, hook: { type: "string" } } },
  { name: "client.prepare_approve_usdc", description: "Approve USDC for job", inputSchema: { amount: { type: "string", required: true } } },
  { name: "client.prepare_fund_job", description: "Fund job calldata", inputSchema: { jobId: { type: "string", required: true } } },

  // Provider
  { name: "provider.prepare_set_budget", description: "Set budget calldata", inputSchema: { jobId: { type: "string", required: true }, amount: { type: "string", required: true } } },
  { name: "provider.prepare_submit_job", description: "Submit job calldata", inputSchema: { jobId: { type: "string", required: true }, deliverableHash: { type: "string", required: true } } },
  { name: "provider.runtime_get_context", description: "Runtime context", inputSchema: { providerAddress: { type: "string" } } },
  { name: "provider.runtime_heartbeat", description: "Runtime heartbeat" },
  { name: "provider.runtime_start_job", description: "Start job execution", inputSchema: { jobId: { type: "string", required: true } } },
  { name: "provider.runtime_write_checkpoint", description: "Write runtime checkpoint", inputSchema: { jobId: { type: "string", required: true }, checkpoint: { type: "object", required: true } } },
  { name: "provider.runtime_get_resume_plan", description: "Get resume plan", inputSchema: { jobId: { type: "string" }, providerAddress: { type: "string" } } },
  { name: "provider.runtime_complete_run", description: "Complete runtime run", inputSchema: { jobId: { type: "string", required: true }, result: { type: "object", required: true }, runId: { type: "string" } } },
  { name: "provider.list_open_jobs", description: "List open jobs", inputSchema: { limit: { type: "number" } } },
  { name: "provider.list_assigned_jobs", description: "List assigned jobs" },
  { name: "provider.apply_open_job", description: "Apply for open job", inputSchema: { jobId: { type: "string", required: true }, capabilities: { type: "array" } } },

  // Evaluator
  { name: "evaluator.prepare_complete_job", description: "Complete job calldata", inputSchema: { jobId: { type: "string", required: true }, reason: { type: "string" } } },
  { name: "evaluator.prepare_reject_job", description: "Reject job calldata", inputSchema: { jobId: { type: "string", required: true }, reason: { type: "string" } } },
];
