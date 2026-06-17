/**
 * ArcLayer Runner Tool Registry
 *
 * Central registry of all callable MCP tools, grouped by source and status.
 * Tools are enabled/disabled by role presets.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type RunnerToolStatus =
  | "active"
  | "legacy"
  | "deprecated"
  | "dev-only"
  | "disabled";

export type RunnerToolRisk =
  | "read-only"
  | "prepare-only"
  | "payment"
  | "runtime"
  | "writes-ledger"
  | "external-process";

export type RunnerToolSource =
  | "runner-local"
  | "skill-context"
  | "console-mcp-proxy";

export type RunnerToolRegistryItem = {
  name: string;
  source: RunnerToolSource;
  status: RunnerToolStatus;
  risk: RunnerToolRisk[];
  capabilities: string[];
  roles: string[];
  requiresPolicy?: boolean;
  requiresCircle?: boolean;
  requiresRuntime?: boolean;
  description: string;
};

// ── Runner-Local Tools (PR #512) ──────────────────────────────────────────

export const RUNNER_LOCAL_TOOLS: RunnerToolRegistryItem[] = [
  // Runner introspection
  { name: "runner.health", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["health"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "Runner health check" },
  { name: "runner.manifest", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["manifest"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "Runner manifest with capabilities" },
  { name: "runner.skill", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["skill"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "Global Agent Skill content and hash" },
  { name: "runner.receipts", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["receipts"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "Recent receipts" },
  { name: "runner.ledger", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["ledger"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "Recent spending ledger records" },
  { name: "runner.policy", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["policy"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "Current spending policy limits" },
  { name: "runner.list_reconcilable_operations", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["reconciliation"], roles: [], description: "List operations needing reconciliation" },
  { name: "runner.reconcile_operation", source: "runner-local", status: "active", risk: ["write"], capabilities: ["reconciliation"], roles: [], description: "Reconcile broadcast/unknown operation" },

  // MCP Tool Broker introspection
  { name: "runner.broker_status", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["broker"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "MCP Tool Broker session state" },
  { name: "runner.audit_log", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["broker", "audit"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "MCP Tool Broker audit log" },

  // Circle CLI
  { name: "circle.status", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["circle", "wallet"], roles: ["provider", "x402-agent", ], requiresCircle: true, description: "Circle CLI version, wallet status, gateway balance" },
  { name: "circle.gateway_balance", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["circle", "gateway"], roles: ["provider", "x402-agent"], requiresCircle: true, description: "Gateway balance for configured wallet" },
  { name: "circle.wallet_balance", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["circle", "wallet"], roles: ["provider", "x402-agent"], requiresCircle: true, description: "Wallet balance for configured wallet" },
  { name: "circle.wallet_budget", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["circle", "wallet", "budget"], roles: ["provider", "x402-agent"], requiresCircle: true, description: "Wallet budget/limit for configured wallet" },
  { name: "circle.wallet_policy_status", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["circle", "policy"], roles: ["provider", "x402-agent", ], requiresCircle: true, description: "Compare Runner policy vs Circle wallet policy caps" },

  // x402
  { name: "x402.inspect", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["x402"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "Inspect x402 service (read-only, no payment)" },
  { name: "x402.pay", source: "runner-local", status: "active", risk: ["payment", "writes-ledger"], capabilities: ["x402", "payment"], roles: ["x402-agent"], requiresPolicy: true, requiresCircle: true, description: "Pay x402 service (requires paymentEnabled + wallet)" },
  { name: "x402.batch_pay", source: "runner-local", status: "active", risk: ["payment", "writes-ledger"], capabilities: ["x402", "payment", "batch"], roles: ["x402-agent"], requiresPolicy: true, requiresCircle: true, description: "Batch pay multiple x402 services" },
  { name: "x402.list_receipts", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["x402", "receipts"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "List x402 payment receipts" },
  { name: "x402.payment_policy", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["x402", "policy"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "Current x402 payment policy (limits, hosts, enabled)" },

  // ERC-8004
  { name: "erc8004.prepare_register", source: "runner-local", status: "active", risk: ["prepare-only"], capabilities: ["erc8004", "identity"], roles: ["provider", "evaluator", "x402-agent"], description: "Prepare ERC-8004 agent registration (unsigned calldata)" },

  // ERC-8183
  { name: "erc8183.provider_run_job", source: "runner-local", status: "active", risk: ["runtime"], capabilities: ["erc8183", "runtime"], roles: ["provider"], requiresRuntime: true, description: "Dispatch job to LLM runtime (no on-chain submit)" },
  { name: "erc8183.provider_submit_deliverable", source: "runner-local", status: "active", risk: ["runtime", "external-process"], capabilities: ["erc8183", "submit"], roles: ["provider"], requiresCircle: true, description: "Submit deliverable on-chain via Circle CLI" },
  { name: "erc8183.provider_run_and_submit", source: "runner-local", status: "active", risk: ["runtime", "external-process"], capabilities: ["erc8183", "runtime", "submit"], roles: ["provider"], requiresRuntime: true, requiresCircle: true, description: "Run job + submit deliverable (full lifecycle)" },
  { name: "erc8183.provider_runtime_status", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["erc8183", "runtime"], roles: ["provider"], description: "Provider runtime context from hosted MCP" },

  // ERC-8183 Full Lifecycle (runner-local)
  { name: "erc8183.create_job", source: "runner-local", status: "active", risk: ["external-process"], capabilities: ["erc8183", "lifecycle"], roles: ["client", ], requiresCircle: true, description: "Create ERC-8183 job on-chain (hook is address, not bytes)" },
  { name: "erc8183.set_budget", source: "runner-local", status: "active", risk: ["external-process"], capabilities: ["erc8183", "lifecycle"], roles: ["provider", ], requiresCircle: true, description: "Set budget for an ERC-8183 job" },
  { name: "erc8183.approve_usdc", source: "runner-local", status: "active", risk: ["external-process"], capabilities: ["erc8183", "usdc"], roles: ["client", ], requiresCircle: true, description: "Approve USDC for ERC-8183 AgenticCommerce contract" },
  { name: "erc8183.fund_job", source: "runner-local", status: "active", risk: ["external-process"], capabilities: ["erc8183", "lifecycle"], roles: ["client", ], requiresCircle: true, description: "Fund an ERC-8183 job (requires prior approve_usdc)" },
  { name: "erc8183.complete_job", source: "runner-local", status: "active", risk: ["external-process"], capabilities: ["erc8183", "lifecycle"], roles: ["evaluator", ], requiresCircle: true, description: "Complete an ERC-8183 job (evaluator action)" },
  { name: "erc8183.reject_job", source: "runner-local", status: "active", risk: ["external-process"], capabilities: ["erc8183", "lifecycle"], roles: ["evaluator", ], requiresCircle: true, description: "Reject an ERC-8183 job (evaluator action)" },
  { name: "erc8183.claim_refund", source: "runner-local", status: "active", risk: ["external-process"], capabilities: ["erc8183", "lifecycle"], roles: ["client"], requiresCircle: true, description: "Claim refund for expired ERC-8183 job (client action)" },
  { name: "erc8183.set_provider", source: "runner-local", status: "active", risk: ["external-process"], capabilities: ["erc8183", "lifecycle"], roles: ["client"], requiresCircle: true, description: "Assign provider to open ERC-8183 job (client action)" },

  // Approvals (client chat-mediated flow)
  { name: "approvals.create", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["approvals", "erc8183"], roles: ["client"], description: "Create pending approval for client ERC-8183 action" },
  { name: "approvals.get", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["approvals"], roles: ["client"], description: "Get approval record by ID" },
  { name: "approvals.approve", source: "runner-local", status: "active", risk: ["external-process"], capabilities: ["approvals", "erc8183"], roles: ["client"], requiresCircle: true, description: "Approve and execute pending approval" },
  { name: "approvals.reject", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["approvals"], roles: ["client"], description: "Reject pending approval" },
  { name: "approvals.cancel", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["approvals"], roles: ["client"], description: "Cancel pending approval" },
  { name: "approvals.list_pending", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["approvals"], roles: ["client"], description: "List pending approvals" },

  // ERC-8004 Register via Circle CLI (guarded)
  { name: "erc8004.register_via_circle_cli", source: "runner-local", status: "active", risk: ["external-process"], capabilities: ["erc8004", "identity"], roles: ["provider", "evaluator", "x402-agent"], requiresCircle: true, description: "Register ERC-8004 identity on-chain. Gated behind allowIdentityRegister." },

  // ERC-8004 Chat-Approved Registration
  { name: "erc8004.register_approval_create", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["erc8004", "identity", "approvals"], roles: ["provider", "evaluator", "x402-agent"], description: "Create pending ERC-8004 registration approval (provider/evaluator)" },
  { name: "erc8004.register_approval_get", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["erc8004", "identity", "approvals"], roles: ["provider", "evaluator", "x402-agent"], description: "Get ERC-8004 registration approval by ID" },
  { name: "erc8004.register_approval_approve", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["erc8004", "identity", "approvals"], roles: ["provider", "evaluator", "x402-agent"], description: "Approve pending ERC-8004 registration approval" },
  { name: "erc8004.register_approval_reject", source: "runner-local", status: "active", risk: ["read-only"], capabilities: ["erc8004", "identity", "approvals"], roles: ["provider", "evaluator", "x402-agent"], description: "Reject pending ERC-8004 registration approval" },
  { name: "erc8004.register_approval_execute", source: "runner-local", status: "active", risk: ["external-process"], capabilities: ["erc8004", "identity", "approvals"], roles: ["provider", "evaluator", "x402-agent"], requiresCircle: true, description: "Execute approved ERC-8004 registration on-chain" },
  { name: "erc8004.register_approval_approve_and_execute", source: "runner-local", status: "active", risk: ["external-process"], capabilities: ["erc8004", "identity", "approvals"], roles: ["provider", "evaluator", "x402-agent"], requiresCircle: true, description: "Approve + execute ERC-8004 registration in one call" },

  // Gateway Deposit (guarded)
  { name: "circle.gateway_deposit", source: "runner-local", status: "active", risk: ["external-process"], capabilities: ["circle", "gateway"], roles: ["x402-agent"], requiresCircle: true, description: "Deposit USDC into Gateway. Gated behind allowGatewayDeposit." },
];

// ── Skill Context Tools (Phase 3) ─────────────────────────────────────────

export const SKILL_CONTEXT_TOOLS: RunnerToolRegistryItem[] = [
  { name: "runner.skills_list", source: "skill-context", status: "active", risk: ["read-only"], capabilities: ["skills"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "List all manifest skills with metadata" },
  { name: "runner.skill_get", source: "skill-context", status: "active", risk: ["read-only"], capabilities: ["skills"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "Get skill content by ID" },
  { name: "runner.skills_bundle", source: "skill-context", status: "active", risk: ["read-only"], capabilities: ["skills", "bundle"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "Bundle skills for a role (context)" },
  { name: "runner.role_profile", source: "skill-context", status: "active", risk: ["read-only"], capabilities: ["roles"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "Role description, capabilities, tool groups" },
  { name: "runner.role_tools", source: "skill-context", status: "active", risk: ["read-only"], capabilities: ["roles", "tools"], roles: ["provider", "client", "evaluator", "x402-agent"], description: "Callable tools enabled for a role" },
];

// ── Console MCP Proxy Tools (Phase 6) ─────────────────────────────────────

export const CONSOLE_MCP_PROXY_TOOLS: RunnerToolRegistryItem[] = [
  // Identity
  { name: "identity.prepare_register_agent", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["identity", "erc8004"], roles: ["provider", "evaluator", "x402-agent"], description: "ERC-8004 register() calldata via Console MCP" },
  { name: "identity.prepare_register_agent_for_session", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["identity", "erc8004"], roles: ["provider", "evaluator", "x402-agent"], description: "Session-bound register via Console MCP" },
  { name: "identity.request_register_agent_approval", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["identity", "erc8004"], roles: ["provider", "evaluator", "x402-agent"], description: "Approval URL for registration" },
  { name: "identity.get_registration_status", source: "console-mcp-proxy", status: "active", risk: ["read-only"], capabilities: ["identity", "erc8004"], roles: ["provider", "evaluator", "x402-agent"], description: "Check registration status" },
  { name: "identity.get_agent_account", source: "console-mcp-proxy", status: "active", risk: ["read-only"], capabilities: ["identity", "erc8004"], roles: ["provider", "evaluator", "x402-agent"], description: "Get agent account details" },

  // Reputation
  { name: "reputation.give_feedback", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["reputation"], roles: ["evaluator"], description: "Submit reputation feedback" },

  // Validation
  { name: "validation.request_calldata", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["validation"], roles: ["evaluator"], description: "Request validation calldata" },
  { name: "validation.response_calldata", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["validation"], roles: ["evaluator"], description: "Response validation calldata" },
  { name: "validation.status_read", source: "console-mcp-proxy", status: "active", risk: ["read-only"], capabilities: ["validation"], roles: ["evaluator"], description: "Read validation status" },

  // Jobs
  { name: "jobs.list_public", source: "console-mcp-proxy", status: "active", risk: ["read-only"], capabilities: ["jobs", "erc8183"], roles: ["provider", "client", "evaluator", ], description: "List public jobs" },
  { name: "jobs.get_public", source: "console-mcp-proxy", status: "active", risk: ["read-only"], capabilities: ["jobs", "erc8183"], roles: ["provider", "client", "evaluator", ], description: "Get job details" },
  { name: "jobs.get_onchain_status", source: "console-mcp-proxy", status: "active", risk: ["read-only"], capabilities: ["jobs", "erc8183"], roles: ["provider", "client", "evaluator"], description: "On-chain job status" },
  { name: "jobs.get_lifecycle_summary", source: "console-mcp-proxy", status: "active", risk: ["read-only"], capabilities: ["jobs", "erc8183"], roles: ["provider", "client", "evaluator"], description: "Job lifecycle summary" },

  // Client
  { name: "client.prepare_create_job", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["client", "erc8183"], roles: ["client"], description: "Create job calldata" },
  { name: "client.prepare_approve_usdc", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["client", "erc8183", "usdc"], roles: ["client"], description: "Approve USDC for job" },
  { name: "client.prepare_fund_job", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["client", "erc8183"], roles: ["client"], description: "Fund job calldata" },

  // Provider
  { name: "provider.prepare_set_budget", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["provider", "erc8183"], roles: ["provider"], description: "Set budget calldata" },
  { name: "provider.prepare_submit_job", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["provider", "erc8183"], roles: ["provider"], description: "Submit job calldata" },
  { name: "provider.runtime_get_context", source: "console-mcp-proxy", status: "active", risk: ["read-only"], capabilities: ["provider", "runtime"], roles: ["provider"], description: "Runtime context" },
  { name: "provider.runtime_heartbeat", source: "console-mcp-proxy", status: "active", risk: ["read-only"], capabilities: ["provider", "runtime"], roles: ["provider"], description: "Runtime heartbeat" },
  { name: "provider.runtime_start_job", source: "console-mcp-proxy", status: "active", risk: ["runtime"], capabilities: ["provider", "runtime"], roles: ["provider"], description: "Start job execution" },
  { name: "provider.runtime_write_checkpoint", source: "console-mcp-proxy", status: "active", risk: ["runtime"], capabilities: ["provider", "runtime"], roles: ["provider"], description: "Write runtime checkpoint" },
  { name: "provider.runtime_get_resume_plan", source: "console-mcp-proxy", status: "active", risk: ["read-only"], capabilities: ["provider", "runtime"], roles: ["provider"], description: "Get resume plan" },
  { name: "provider.runtime_complete_run", source: "console-mcp-proxy", status: "active", risk: ["runtime"], capabilities: ["provider", "runtime"], roles: ["provider"], description: "Complete runtime run" },
  { name: "provider.list_open_jobs", source: "console-mcp-proxy", status: "active", risk: ["read-only"], capabilities: ["provider", "jobs"], roles: ["provider"], description: "List open jobs" },
  { name: "provider.list_assigned_jobs", source: "console-mcp-proxy", status: "active", risk: ["read-only"], capabilities: ["provider", "jobs"], roles: ["provider"], description: "List assigned jobs" },
  { name: "provider.apply_open_job", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["provider", "jobs"], roles: ["provider"], description: "Apply for open job" },
  { name: "provider.runtime_retry_job", source: "console-mcp-proxy", status: "active", risk: ["runtime"], capabilities: ["provider", "runtime"], roles: ["provider"], description: "Retry a failed provider job run" },

  // Evaluator
  { name: "evaluator.prepare_complete_job", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["evaluator", "erc8183"], roles: ["evaluator"], description: "Complete job calldata" },
  { name: "evaluator.prepare_reject_job", source: "console-mcp-proxy", status: "active", risk: ["prepare-only"], capabilities: ["evaluator", "erc8183"], roles: ["evaluator"], description: "Reject job calldata" },
];

// ── Combined Registry ─────────────────────────────────────────────────────

export const ALL_TOOLS: RunnerToolRegistryItem[] = [
  ...RUNNER_LOCAL_TOOLS,
  ...SKILL_CONTEXT_TOOLS,
  ...CONSOLE_MCP_PROXY_TOOLS,
];

/**
 * Get tools enabled for a specific role.
 */
export function getToolsForRole(role: string): RunnerToolRegistryItem[] {
  return ALL_TOOLS.filter(
    (t) => t.status === "active" && t.roles.includes(role)
  );
}

/**
 * Get tool by name.
 */
export function getToolByName(name: string): RunnerToolRegistryItem | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

/**
 * Check if a tool name is in the proxy allowlist.
 */
export function isProxyToolAllowed(name: string): boolean {
  return CONSOLE_MCP_PROXY_TOOLS.some(
    (t) => t.name === name && t.status === "active"
  );
}

/**
 * Get all tool names for a role (as MCP tools/list format).
 */
export function getToolNamesForRole(role: string): string[] {
  return getToolsForRole(role).map((t) => t.name);
}
