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

  // ── Autonomous ERC-8183 High-Level Tools ────────────────────────────────
  {
    name: "erc8183.client_create_and_fund",
    description: "Create and fund an ERC-8183 job in one call. Encodes versioned job envelope, creates job, sets budget, approves USDC, funds. Idempotent by requestId.",
    inputSchema: [
      { name: "requestId", type: "string", required: true, description: "Unique request ID for idempotency." },
      { name: "task", type: "string", required: true, description: "Task description for the provider." },
      { name: "input", type: "string", description: "Optional task input (JSON)." },
      { name: "acceptanceCriteria", type: "string", required: true, description: "JSON array of acceptance criteria strings." },
      { name: "outputFormat", type: "string", description: "Output format: text, json, markdown." },
      { name: "budgetUsdc", type: "string", required: true, description: "Budget in human-readable USDC (e.g. '0.1')." },
      { name: "provider", type: "string", required: true, description: "Provider wallet address." },
      { name: "evaluator", type: "string", required: true, description: "Evaluator wallet address (non-zero)." },
      { name: "expiresInSeconds", type: "number", description: "Job expiry in seconds (default 3600)." },
      { name: "x402Allowed", type: "boolean", description: "Allow x402 payments (default false)." },
      { name: "x402MaxSpendUsdc", type: "string", description: "Max x402 spend per job in USDC." },
      { name: "x402AllowedHosts", type: "string", description: "JSON array of allowed x402 hosts." },
    ]
  },
  {
    name: "erc8183.client_workflow_status",
    description: "Get status of a client create-and-fund workflow. Returns state, jobId, operations, events.",
    inputSchema: [
      { name: "requestId", type: "string", description: "Request ID to look up." },
      { name: "jobId", type: "string", description: "Job ID to look up." },
    ]
  },
  {
    name: "erc8183.autonomy_status",
    description: "Get autonomy worker health status. Returns enabled, role, activeWorkflows, lastPollAt.",
    inputSchema: []
  },
  {
    name: "erc8183.autonomy_events",
    description: "List autonomy workflow events. Returns event log for a workflow.",
    inputSchema: [
      { name: "workflowId", type: "string", description: "Workflow ID." },
      { name: "jobId", type: "string", description: "Job ID (looks up workflow by job)." },
    ]
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
// Canonical source: apps/console/src/lib/mcp/tool-catalog.ts
// These are proxied to Console MCP via ArcLayerMcpConnector.callTool().
// NOTE: agentId is auto-injected by the connector — do NOT include it here.
// Keep in sync with Hosted Console catalog. Run parity test to verify.

export const CONSOLE_PROXY_MCP_TOOLS: McpToolDef[] = [
  // ── Identity ──────────────────────────────────────────────────────────
  {
    name: "identity.prepare_register_agent",
    description: "Build unsigned calldata for ERC-8004 IdentityRegistry.register(metadataURI).",
    inputSchema: { metadataURI: { type: "string", required: true, description: "Public agent manifest URL (HTTPS or IPFS)." } },
  },
  {
    name: "identity.prepare_register_agent_for_session",
    description: "Validate agent metadata and build encoded calldata for ERC-8004 IdentityRegistry.register(metadataURI). Authenticated.",
    inputSchema: {
      name: { type: "string", required: true, description: "Agent name (max 128 chars)." },
      role: { type: "string", required: true, description: "Agent role: provider, client, evaluator, agent, oracle, analyzer, executor, worker, buyer, settler." },
      capabilities: { type: "array", required: true, description: "Array of capability strings (non-empty, max 20)." },
      description: { type: "string", required: true, description: "Agent description (max 1024 chars)." },
      endpoint: { type: "string", description: "Optional endpoint URL." },
    },
  },
  {
    name: "identity.request_register_agent_approval",
    description: "Prepare + create approval for ERC-8004 identity registration in one call.",
    inputSchema: {
      name: { type: "string", required: true, description: "Agent name (max 128 chars)." },
      role: { type: "string", required: true, description: "Agent role: provider, client, evaluator, agent, oracle, analyzer, executor, worker, buyer, settler." },
      capabilities: { type: "array", required: true, description: "Array of capability strings (non-empty, max 20)." },
      description: { type: "string", required: true, description: "Agent description (max 1024 chars)." },
      endpoint: { type: "string", description: "Optional endpoint URL." },
    },
  },
  {
    name: "identity.get_registration_status",
    description: "Get the status of an identity registration approval.",
    inputSchema: { approvalId: { type: "string", required: true, description: "Approval ID from request_register_agent_approval." } },
  },
  {
    name: "identity.get_agent_account",
    description: "Get the agent account (Circle Smart Account) bound to the authenticated MCP session.",
    // No inputSchema — Console has empty inputSchema
  },

  // ── Reputation ────────────────────────────────────────────────────────
  {
    name: "reputation.give_feedback",
    description: "Build unsigned calldata for ERC-8004 ReputationRegistry.giveFeedback(...).",
    inputSchema: {
      agentTokenId: { type: "string", required: true },
      score: { type: "string", required: true },
      category: { type: "string", required: true },
      comment: { type: "string", required: true },
      metadataURI: { type: "string", required: true },
      proofURI: { type: "string", required: true },
      context: { type: "string", required: true },
      ref: { type: "string", required: true },
    },
  },

  // ── Validation ────────────────────────────────────────────────────────
  {
    name: "validation.request_calldata",
    description: "Build unsigned calldata for ERC-8004 ValidationRegistry.validationRequest(...).",
    inputSchema: {
      validator: { type: "string", required: true },
      agentTokenId: { type: "string", required: true },
      taskUri: { type: "string", required: true },
      requestHash: { type: "string", required: true },
    },
  },
  {
    name: "validation.response_calldata",
    description: "Build unsigned calldata for ERC-8004 ValidationRegistry.validationResponse(...).",
    inputSchema: {
      requestHash: { type: "string", required: true },
      status: { type: "string", required: true },
      resultUri: { type: "string", required: true },
      resultHash: { type: "string", required: true },
      reason: { type: "string", required: true },
    },
  },
  {
    name: "validation.status_read",
    description: "Read helper for ValidationRegistry.getValidationStatus([requestHash]).",
    inputSchema: { requestHash: { type: "string", required: true } },
  },

  // ── Jobs (read) ───────────────────────────────────────────────────────
  {
    name: "jobs.list_public",
    description: "List jobs from the indexer. Supports optional status and evaluatorAddress filters.",
    inputSchema: {
      status: { type: "string", description: "created | funded | submitted | completed" },
      evaluatorAddress: { type: "string", description: "Filter by evaluator address (case-insensitive)." },
      limit: { type: "number", description: "Optional max count (1-50)." },
    },
  },
  {
    name: "jobs.get_public",
    description: "Get a single job by jobId.",
    inputSchema: { jobId: { type: "string", required: true, description: "Job ID." } },
  },
  {
    name: "jobs.get_onchain_status",
    description: "Read on-chain ERC-8183 job state via AgenticCommerce.getJob().",
    inputSchema: { jobId: { type: "string", required: true, description: "Job ID (uint256)." } },
  },
  {
    name: "jobs.get_lifecycle_summary",
    description: "Compute next actor/action for an ERC-8183 job based on on-chain state.",
    inputSchema: { jobId: { type: "string", required: true, description: "Job ID (uint256)." } },
  },

  // ── Client (tx prepare) ───────────────────────────────────────────────
  {
    name: "client.prepare_create_job",
    description: "Build unsigned calldata for ERC-8183 AgenticCommerce.createJob(provider, evaluator, expiredAt, description, hook).",
    inputSchema: {
      provider: { type: "string", required: true, description: "Provider/worker wallet address." },
      evaluator: { type: "string", required: true, description: "Evaluator wallet address." },
      expiredAt: { type: "string", required: true, description: "Unix timestamp when job expires." },
      description: { type: "string", required: true, description: "Job description string." },
      hook: { type: "string", description: "Optional hook contract address (default: 0x0)." },
    },
  },
  {
    name: "client.prepare_approve_usdc",
    description: "Build unsigned calldata for USDC.approve(AgenticCommerce, amount). Must be called before fund().",
    inputSchema: { amount: { type: "string", required: true, description: "Amount in USDC atomic units (6 decimals)." } },
  },
  {
    name: "client.prepare_fund_job",
    description: "Build unsigned calldata for ERC-8183 AgenticCommerce.fund(jobId, optParams).",
    inputSchema: {
      jobId: { type: "string", required: true, description: "Job ID (uint256)." },
      optParams: { type: "string", description: "Optional bytes payload (default \"0x\")." },
    },
  },

  // ── Provider (tx prepare) ─────────────────────────────────────────────
  {
    name: "provider.prepare_set_budget",
    description: "Build unsigned calldata for ERC-8183 AgenticCommerce.setBudget(jobId, amount, optParams).",
    inputSchema: {
      jobId: { type: "string", required: true, description: "Job ID (uint256)." },
      amount: { type: "string", required: true, description: "Budget in USDC atomic units (6 decimals)." },
      optParams: { type: "string", description: "Optional bytes payload (default \"0x\")." },
    },
  },
  {
    name: "provider.prepare_submit_job",
    description: "Build unsigned calldata for ERC-8183 AgenticCommerce.submit(jobId, deliverableHash, optParams).",
    inputSchema: {
      jobId: { type: "string", required: true, description: "Job ID (uint256)." },
      deliverableHash: { type: "string", required: true, description: "Keccak256 hash of the deliverable content." },
      optParams: { type: "string", description: "Optional bytes payload (default \"0x\")." },
    },
  },

  // ── Provider Runtime ──────────────────────────────────────────────────
  {
    name: "provider.runtime_get_context",
    description: "Get provider runtime context: state, active run, latest checkpoint, active applications, resume plan.",
    inputSchema: { providerAddress: { type: "string", description: "Provider wallet address. If provided, resume plan verifies on-chain provider matches." } },
  },
  {
    name: "provider.runtime_heartbeat",
    description: "Update provider last_seen_at. Creates runtime state if missing.",
    // No inputSchema beyond agentId (auto-injected)
  },
  {
    name: "provider.runtime_start_job",
    description: "Start a new job run or return existing active run. Idempotent on provider:agentId:job:jobId.",
    inputSchema: {
      jobId: { type: "string", required: true, description: "ERC-8183 job ID." },
      phase: { type: "string", description: "Initial phase (default: budget_tx_sent)." },
    },
  },
  {
    name: "provider.runtime_write_checkpoint",
    description: "Write an append-only checkpoint for a job run. NOT idempotent — each call creates a new row.",
    inputSchema: {
      jobId: { type: "string", required: true, description: "ERC-8183 job ID." },
      runId: { type: "string", description: "Run ID (auto-resolved if omitted)." },
      phase: { type: "string", required: true, description: "Checkpoint phase." },
      status: { type: "string", required: true, description: "Checkpoint status." },
      txHash: { type: "string", description: "Transaction hash (if applicable)." },
      deliverableHash: { type: "string", description: "Deliverable hash (if applicable)." },
      payloadHash: { type: "string", description: "Payload hash (if applicable)." },
      note: { type: "string", description: "Human-readable note." },
      metadata: { type: "object", description: "Additional metadata." },
    },
  },
  {
    name: "provider.runtime_get_resume_plan",
    description: "Compute next provider action from checkpoint + on-chain state.",
    inputSchema: {
      jobId: { type: "string", description: "Specific job ID (optional, uses active run if omitted)." },
      providerAddress: { type: "string", description: "Provider wallet address. Verifies on-chain provider matches this bot." },
    },
  },
  {
    name: "provider.runtime_retry_job",
    description: "Retry a failed provider job run.",
    inputSchema: {
      jobId: { type: "string", required: true, description: "ERC-8183 job ID to retry." },
      reason: { type: "string", description: "Reason for retry (default: manual retry)." },
    },
  },
  {
    name: "provider.runtime_complete_run",
    description: "Mark a job run as completed. Clears active job/run from runtime state.",
    inputSchema: {
      jobId: { type: "string", required: true, description: "ERC-8183 job ID." },
      runId: { type: "string", required: true, description: "Run ID to complete." },
    },
  },
  {
    name: "provider.list_open_jobs",
    description: "List open/global jobs where provider = address(0). Server-side filtered, bounded pagination.",
    inputSchema: {
      limit: { type: "number", description: "Max results (1-50, default 20)." },
      minBudgetUsdc: { type: "string", description: "Minimum budget in USDC." },
      includeExpired: { type: "boolean", description: "Include expired jobs (default false)." },
    },
  },
  {
    name: "provider.list_assigned_jobs",
    description: "List jobs assigned to a specific provider address (provider = address, status = Open).",
    inputSchema: {
      providerAddress: { type: "string", required: true, description: "Provider wallet address to search for." },
      limit: { type: "number", description: "Max results (1-50, default 20)." },
    },
  },
  {
    name: "provider.apply_open_job",
    description: "Apply to an open/global job. Provider bot must NOT call setProvider — client assigns onchain.",
    inputSchema: {
      jobId: { type: "string", required: true, description: "ERC-8183 job ID." },
      providerAddress: { type: "string", required: true, description: "Provider wallet address." },
      quoteAmountUsdc: { type: "string", description: "Quote amount in USDC (e.g. \"1.5\")." },
      quoteAmountAtomic: { type: "string", description: "Quote amount in atomic units (6 decimals)." },
      message: { type: "string", description: "Application message." },
      capabilities: { type: "array", description: "Provider capabilities array (string[])." },
      metadata: { type: "object", description: "Additional metadata." },
    },
  },

  // ── Evaluator (tx prepare) ────────────────────────────────────────────
  {
    name: "evaluator.prepare_complete_job",
    description: "Build unsigned calldata for ERC-8183 AgenticCommerce.complete(jobId, reason, optParams).",
    inputSchema: {
      jobId: { type: "string", required: true, description: "Job ID (uint256)." },
      reason: { type: "string", description: "Reason string (will be keccak256-hashed) OR a 0x-prefixed 32-byte hash." },
      reasonHash: { type: "string", description: "Optional pre-computed bytes32 reason hash; takes precedence." },
      optParams: { type: "string", description: "Optional bytes payload (default \"0x\")." },
    },
  },
  {
    name: "evaluator.prepare_reject_job",
    description: "Build unsigned calldata for ERC-8183 AgenticCommerce.reject(jobId, reason, optParams).",
    inputSchema: {
      jobId: { type: "string", required: true, description: "Job ID (uint256)." },
      reason: { type: "string", description: "Reason string (will be keccak256-hashed) OR a 0x-prefixed 32-byte hash." },
      reasonHash: { type: "string", description: "Optional pre-computed bytes32 reason hash; takes precedence." },
      optParams: { type: "string", description: "Optional bytes payload (default \"0x\")." },
    },
  },
];
