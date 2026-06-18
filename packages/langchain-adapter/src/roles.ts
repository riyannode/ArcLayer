/**
 * @arclayer/langchain-adapter — Role presets.
 *
 * Defines which tools are available for each role.
 * "read-only" is SDK-only preset.
 * The Runner only knows: provider, client, evaluator, x402-agent.
 */

import type { ArcLayerAgentRole } from "./types.js";

type RolePreset = {
  id: ArcLayerAgentRole;
  title: string;
  description: string;
  allowedTools: string[];
  runnerRole?: string; // Mapped Runner role (undefined = SDK-only)
};

type RoleToolOverrides = {
  allowedTools?: string[];
  deniedTools?: string[];
  enableProviderRunAndSubmit?: boolean;
  enableProviderSetBudget?: boolean;
  enableProviderPublishDeliverable?: boolean;
  enableProviderSubmitDeliverable?: boolean;
};

const PROVIDER_RUN_AND_SUBMIT_TOOL = "erc8183_provider_run_and_submit";
const PROVIDER_QUOTE_JOB_TOOL = "erc8183_provider_quote_job";
const PROVIDER_SET_BUDGET_TOOL = "erc8183_provider_set_budget";
const PROVIDER_SUBMIT_DELIVERABLE_TOOL = "erc8183_provider_submit_deliverable";

/** All provider runtime proxy tools (read + write). */
const PROVIDER_RUNTIME_TOOLS = [
  "erc8183_provider_get_context",
  "erc8183_provider_get_resume_plan",
  "erc8183_provider_heartbeat",
  "erc8183_provider_start_job",
  "erc8183_provider_write_checkpoint",
  "erc8183_provider_retry_job",
  "erc8183_provider_complete_run",
];

/** All provider marketplace tools (read + apply/withdraw). */
const PROVIDER_MARKETPLACE_TOOLS = [
  "erc8183_provider_list_assigned_jobs",
  "erc8183_provider_list_assigned_jobs_extended",
  "erc8183_provider_list_open_jobs",
  "erc8183_provider_list_my_open_job_applications",
  "erc8183_provider_apply_open_job",
  "erc8183_provider_withdraw_open_job_application",
];

/** Provider deliverable + on-chain write tools (opt-in). */
const PROVIDER_ONCHAIN_WRITE_TOOLS = [
  "erc8183_provider_publish_deliverable",
  "erc8183_provider_submit_deliverable",
];

/** Shared read tools available to all roles. */
const SHARED_READ_TOOLS = [
  "x402_inspect",
  "payment_receipts",
  "payment_spend_ledger",
  "erc8183_job_status",
  "erc8183_job_lifecycle_summary",
];

const ROLE_PRESETS: RolePreset[] = [
  {
    id: "read-only",
    title: "Read Only",
    description:
      "Can inspect x402 resources, read receipts, ledger, job status, and lifecycle. No payments.",
    allowedTools: [
      ...SHARED_READ_TOOLS,
    ],
    // No runnerRole — SDK-only filter
  },
  {
    id: "x402-agent",
    title: "x402 Agent",
    description:
      "Can inspect, pay, batch pay x402 resources, read receipts, ledger, job status, and lifecycle.",
    allowedTools: [
      ...SHARED_READ_TOOLS,
      "x402_pay",
      "x402_batch_pay",
    ],
    runnerRole: "x402-agent",
  },
  {
    id: "provider",
    title: "Provider",
    description:
      "Full provider surface: runtime tools, marketplace, quote, run-only. " +
      "Run-and-submit, set-budget, submit-deliverable, publish-deliverable require explicit opt-in.",
    allowedTools: [
      ...SHARED_READ_TOOLS,
      ...PROVIDER_RUNTIME_TOOLS,
      ...PROVIDER_MARKETPLACE_TOOLS,
      "erc8183_provider_run_only",
      "erc8183_provider_quote_job",
    ],
    runnerRole: "provider",
  },
  {
    id: "evaluator",
    title: "Evaluator",
    description:
      "Can read receipts, ledger, job status, and lifecycle. ERC-8183 evaluator tools (future PR).",
    allowedTools: [
      ...SHARED_READ_TOOLS,
    ],
    runnerRole: "evaluator",
  },
  {
    id: "client",
    title: "Client",
    description:
      "Can read receipts, ledger, job status, and lifecycle. ERC-8183 client tools (future PR).",
    allowedTools: [
      ...SHARED_READ_TOOLS,
    ],
    runnerRole: "client",
  },
];

/**
 * Get the list of allowed tool names for a role,
 * applying enableProviderRunAndSubmit, enableProviderSetBudget,
 * deniedTools, and allowedTools overrides.
 *
 * Precedence: deniedTools > enableProviderSetBudget > enableProviderRunAndSubmit > allowedTools > role preset
 */
export function getArcLayerToolsForRole(
  role: ArcLayerAgentRole,
  overrides?: RoleToolOverrides,
): string[] {
  const preset = ROLE_PRESETS.find((p) => p.id === role);
  if (!preset) {
    throw new Error(`Unknown role: ${role}`);
  }

  let tools = [...preset.allowedTools];

  // Explicit opt-in: add run-and-submit only for provider role when enabled
  if (role === "provider" && overrides?.enableProviderRunAndSubmit) {
    tools.push(PROVIDER_RUN_AND_SUBMIT_TOOL);
  }

  // Explicit opt-in: add set-budget only for provider role when enabled
  if (role === "provider" && overrides?.enableProviderSetBudget) {
    tools.push(PROVIDER_SET_BUDGET_TOOL);
  }

  // Explicit opt-in: add publish-deliverable only for provider role when enabled
  if (role === "provider" && overrides?.enableProviderPublishDeliverable) {
    tools.push("erc8183_provider_publish_deliverable");
  }

  // Explicit opt-in: add submit-deliverable only for provider role when enabled
  if (role === "provider" && overrides?.enableProviderSubmitDeliverable) {
    tools.push(PROVIDER_SUBMIT_DELIVERABLE_TOOL);
  }

  // Deduplicate
  tools = Array.from(new Set(tools));

  // Apply allowedTools override (intersect with current set)
  if (overrides?.allowedTools?.length) {
    tools = tools.filter((t) => overrides.allowedTools!.includes(t));
  }

  // Apply deniedTools override (remove from set) — highest precedence
  if (overrides?.deniedTools?.length) {
    tools = tools.filter((t) => !overrides.deniedTools!.includes(t));
  }

  return tools;
}

/**
 * Get the Runner role string for an SDK role.
 * Returns undefined for SDK-only roles (read-only).
 */
export function getRunnerRoleForSdkRole(
  role: ArcLayerAgentRole,
): string | undefined {
  const preset = ROLE_PRESETS.find((p) => p.id === role);
  return preset?.runnerRole;
}

/**
 * Get all available role presets.
 */
export function listRolePresets(): Array<{
  id: string;
  title: string;
  description: string;
}> {
  return ROLE_PRESETS.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
  }));
}
