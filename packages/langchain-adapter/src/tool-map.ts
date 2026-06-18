/**
 * @arclayer/langchain-adapter — Tool name mapping.
 *
 * Maps SDK-friendly LangChain tool names to Runner HTTP paths and MCP names.
 * MCP names are internal; LangChain names use protocol-first prefix + snake_case.
 *
 * Tools with adapterOnly: true are handled entirely by the adapter —
 * they do not make Runner HTTP calls.
 */

import type { ToolMapEntry } from "./types.js";

export const TOOL_NAME_MAP: Record<string, ToolMapEntry> = {
  x402_inspect: {
    runnerPath: "/x402/inspect",
    method: "POST",
    mcpName: "x402.inspect",
    risk: "read",
  },
  x402_pay: {
    runnerPath: "/x402/pay",
    method: "POST",
    mcpName: "x402.pay",
    risk: "payment",
  },
  x402_batch_pay: {
    runnerPath: "/x402/batch-pay",
    method: "POST",
    mcpName: "x402.batch_pay",
    risk: "payment",
  },
  payment_receipts: {
    runnerPath: "/receipts",
    method: "GET",
    mcpName: "x402.list_receipts",
    risk: "read",
  },
  payment_spend_ledger: {
    runnerPath: "/ledger",
    method: "GET",
    mcpName: "runner.ledger",
    risk: "read",
  },
  erc8183_provider_run_only: {
    runnerPath: "/erc8183/provider/run-only",
    method: "POST",
    mcpName: "erc8183.provider_run_job",
    risk: "write",
  },
  erc8183_provider_run_and_submit: {
    runnerPath: "/erc8183/provider/run-and-submit",
    method: "POST",
    mcpName: "erc8183.provider_run_and_submit",
    risk: "write",
  },
  erc8183_provider_quote_job: {
    runnerPath: "",
    method: "POST",
    mcpName: "erc8183.provider_quote_job",
    risk: "read",
    adapterOnly: true,
  },
  erc8183_provider_set_budget: {
    runnerPath: "/erc8183/provider/set-budget",
    method: "POST",
    mcpName: "erc8183.set_budget",
    risk: "write",
  },

  // ── Provider Runtime (Console MCP proxy) ────────────────────────────
  erc8183_provider_get_context: {
    runnerPath: "/provider/context",
    method: "POST",
    mcpName: "provider.runtime_get_context",
    risk: "read",
  },
  erc8183_provider_get_resume_plan: {
    runnerPath: "/provider/resume-plan",
    method: "POST",
    mcpName: "provider.runtime_get_resume_plan",
    risk: "read",
  },
  erc8183_provider_heartbeat: {
    runnerPath: "/provider/heartbeat",
    method: "POST",
    mcpName: "provider.runtime_heartbeat",
    risk: "write",
  },
  erc8183_provider_start_job: {
    runnerPath: "/provider/start-job",
    method: "POST",
    mcpName: "provider.runtime_start_job",
    risk: "write",
  },
  erc8183_provider_write_checkpoint: {
    runnerPath: "/provider/write-checkpoint",
    method: "POST",
    mcpName: "provider.runtime_write_checkpoint",
    risk: "write",
  },
  erc8183_provider_retry_job: {
    runnerPath: "/provider/retry-job",
    method: "POST",
    mcpName: "provider.runtime_retry_job",
    risk: "write",
  },
  erc8183_provider_complete_run: {
    runnerPath: "/provider/complete-run",
    method: "POST",
    mcpName: "provider.runtime_complete_run",
    risk: "write",
  },

  // ── Provider Marketplace ────────────────────────────────────────────
  erc8183_provider_list_assigned_jobs: {
    runnerPath: "/provider/list-assigned-jobs",
    method: "POST",
    mcpName: "provider.list_assigned_jobs",
    risk: "read",
  },
  erc8183_provider_list_assigned_jobs_extended: {
    runnerPath: "/provider/list-assigned-jobs-extended",
    method: "POST",
    mcpName: "provider.list_assigned_jobs_extended",
    risk: "read",
  },
  erc8183_provider_list_open_jobs: {
    runnerPath: "/provider/list-open-jobs",
    method: "POST",
    mcpName: "provider.list_open_jobs",
    risk: "read",
  },
  erc8183_provider_list_my_open_job_applications: {
    runnerPath: "/provider/list-my-open-job-applications",
    method: "POST",
    mcpName: "provider.list_my_open_job_applications",
    risk: "read",
  },
  erc8183_provider_apply_open_job: {
    runnerPath: "/provider/apply-open-job",
    method: "POST",
    mcpName: "provider.apply_open_job",
    risk: "write",
  },
  erc8183_provider_withdraw_open_job_application: {
    runnerPath: "/provider/withdraw-open-job-application",
    method: "POST",
    mcpName: "provider.withdraw_open_job_application",
    risk: "write",
  },
  erc8183_provider_publish_deliverable: {
    runnerPath: "/provider/publish-deliverable",
    method: "POST",
    mcpName: "provider.publish_deliverable",
    risk: "write",
  },

  // ── Provider Submit Deliverable (runner-local) ──────────────────────
  erc8183_provider_submit_deliverable: {
    runnerPath: "/erc8183/provider/submit-deliverable",
    method: "POST",
    mcpName: "erc8183.provider_submit_deliverable",
    risk: "write",
  },

  // ── Job Status (Console MCP proxy) ──────────────────────────────────
  erc8183_job_status: {
    runnerPath: "/jobs/onchain-status",
    method: "POST",
    mcpName: "jobs.get_onchain_status",
    risk: "read",
  },
  erc8183_job_lifecycle_summary: {
    runnerPath: "/jobs/lifecycle-summary",
    method: "POST",
    mcpName: "jobs.get_lifecycle_summary",
    risk: "read",
  },
};

/**
 * Get all registered tool names.
 */
export function getAllToolNames(): string[] {
  return Object.keys(TOOL_NAME_MAP);
}

/**
 * Get tool entry by LangChain tool name.
 */
export function getToolEntry(
  name: string,
): ToolMapEntry | undefined {
  return TOOL_NAME_MAP[name];
}
