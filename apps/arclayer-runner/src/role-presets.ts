/**
 * ArcLayer Runner Role Presets
 *
 * Defines capabilities, tool groups, and default policies for each role.
 * Used by setup wizard, role_profile, and role_tools MCP tools.
 */

import type { RunnerRole } from "./skill-manifest";

// ── Types ─────────────────────────────────────────────────────────────────

export type RunnerRolePreset = {
  id: RunnerRole;
  title: string;
  description: string;
  capabilities: string[];
  toolGroups: string[];
  defaultPolicy?: Record<string, unknown>;
  requiredConfigFields: string[];
  optionalConfigFields: string[];
};

// ── Presets ────────────────────────────────────────────────────────────────

export const ROLE_PRESETS: RunnerRolePreset[] = [
  {
    id: "provider",
    title: "Provider",
    description: "Run jobs, submit deliverables, earn USDC. Full ERC-8183 lifecycle with Circle CLI adapter.",
    capabilities: ["erc8183", "erc8004", "x402", "runtime", "receipts", "ledger", "circle"],
    toolGroups: [
      "runner.*",
      "circle.status",
      "circle.wallet_balance",
      "circle.wallet_budget",
      "circle.wallet_policy_status",
      "x402.inspect",
      "x402.list_receipts",
      "x402.payment_policy",
      "erc8004.prepare_register",
      "erc8183.provider_run_job",
      "erc8183.provider_submit_deliverable",
      "erc8183.provider_run_and_submit",
      "erc8183.provider_runtime_status",
      "erc8183.set_budget",
      "runner.skills_list",
      "runner.skill_get",
      "runner.skills_bundle",
      "runner.role_profile",
      "runner.role_tools",
      "identity.prepare_register_agent",
      "identity.get_registration_status",
      "identity.get_agent_account",
      "provider.prepare_set_budget",
      "provider.prepare_submit_job",
      "provider.runtime_get_context",
      "provider.runtime_heartbeat",
      "provider.runtime_start_job",
      "provider.runtime_write_checkpoint",
      "provider.runtime_get_resume_plan",
      "provider.runtime_complete_run",
      "provider.list_open_jobs",
      "provider.list_assigned_jobs",
      "provider.apply_open_job",
      "jobs.list_public",
      "jobs.get_public",
      "jobs.get_onchain_status",
      "jobs.get_lifecycle_summary",
    ],
    defaultPolicy: {
      paymentEnabled: false,
      perTxLimitUsdc: "0.01",
      dailyLimitUsdc: "1",
      monthlyLimitUsdc: "20",
    },
    requiredConfigFields: ["agentId", "role", "circle.walletAddress"],
    optionalConfigFields: ["circle.chain", "runtime.endpoint"],
  },
  {
    id: "client",
    title: "Client",
    description: "Create jobs, fund escrow, approve USDC. Client-side of ERC-8183 lifecycle.",
    capabilities: ["erc8183", "x402", "jobs", "usdc"],
    toolGroups: [
      "runner.*",
      "x402.inspect",
      "x402.payment_policy",
      "erc8183.create_job",
      "erc8183.approve_usdc",
      "erc8183.fund_job",
      "erc8183.claim_refund",
      "erc8183.set_provider",
      "approvals.create",
      "approvals.get",
      "approvals.approve",
      "approvals.reject",
      "approvals.cancel",
      "approvals.list_pending",
      "runner.skills_list",
      "runner.skill_get",
      "runner.skills_bundle",
      "runner.role_profile",
      "runner.role_tools",
      "client.prepare_create_job",
      "client.prepare_approve_usdc",
      "client.prepare_fund_job",
      "jobs.list_public",
      "jobs.get_public",
      "jobs.get_onchain_status",
      "jobs.get_lifecycle_summary",
    ],
    defaultPolicy: {
      paymentEnabled: false,
    },
    requiredConfigFields: ["agentId", "role"],
    optionalConfigFields: ["circle.walletAddress", "circle.chain"],
  },
  {
    id: "evaluator",
    title: "Evaluator",
    description: "Evaluate job deliverables, approve or reject submissions. Quality assurance role.",
    capabilities: ["erc8183", "validation", "reputation"],
    toolGroups: [
      "runner.*",
      "erc8183.complete_job",
      "erc8183.reject_job",
      "runner.skills_list",
      "runner.skill_get",
      "runner.skills_bundle",
      "runner.role_profile",
      "runner.role_tools",
      "evaluator.prepare_complete_job",
      "evaluator.prepare_reject_job",
      "validation.status_read",
      "jobs.list_public",
      "jobs.get_public",
      "jobs.get_onchain_status",
      "jobs.get_lifecycle_summary",
    ],
    defaultPolicy: {
      paymentEnabled: false,
    },
    requiredConfigFields: ["agentId", "role"],
    optionalConfigFields: ["circle.walletAddress"],
  },
  {
    id: "x402-agent",
    title: "x402 Agent",
    description: "Pay-per-call agent. Discovers, inspects, and pays for x402-protected services.",
    capabilities: ["x402", "payment", "circle", "receipts", "ledger"],
    toolGroups: [
      "runner.*",
      "circle.status",
      "circle.wallet_balance",
      "circle.wallet_budget",
      "circle.wallet_policy_status",
      "x402.inspect",
      "x402.pay",
      "x402.batch_pay",
      "x402.list_receipts",
      "x402.payment_policy",
      "runner.skills_list",
      "runner.skill_get",
      "runner.skills_bundle",
      "runner.role_profile",
      "runner.role_tools",
    ],
    defaultPolicy: {
      paymentEnabled: true,
      perTxLimitUsdc: "0.05",
      dailyLimitUsdc: "5",
      monthlyLimitUsdc: "50",
    },
    requiredConfigFields: ["agentId", "role", "circle.walletAddress"],
    optionalConfigFields: ["circle.chain"],
  },
  {
    id: "identity-agent",
    title: "Identity Agent",
    description: "Manage ERC-8004 agent identity, registration, reputation, and validation.",
    capabilities: ["erc8004", "identity", "reputation", "validation"],
    toolGroups: [
      "runner.*",
      "erc8004.prepare_register",
      "erc8004.register_via_circle_cli",
      "runner.skills_list",
      "runner.skill_get",
      "runner.skills_bundle",
      "runner.role_profile",
      "runner.role_tools",
      "identity.prepare_register_agent",
      "identity.prepare_register_agent_for_session",
      "identity.request_register_agent_approval",
      "identity.get_registration_status",
      "identity.get_agent_account",
      "reputation.give_feedback",
      "validation.request_calldata",
      "validation.response_calldata",
      "validation.status_read",
    ],
    defaultPolicy: {
      paymentEnabled: false,
    },
    requiredConfigFields: ["agentId", "role"],
    optionalConfigFields: ["circle.walletAddress"],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

export function getRolePreset(role: string): RunnerRolePreset | undefined {
  return ROLE_PRESETS.find((p) => p.id === role);
}

export function listRolePresets(): Array<{ id: string; title: string; description: string }> {
  return ROLE_PRESETS.map((p) => ({ id: p.id, title: p.title, description: p.description }));
}
