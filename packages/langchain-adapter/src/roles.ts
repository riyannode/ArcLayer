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

const ROLE_PRESETS: RolePreset[] = [
  {
    id: "read-only",
    title: "Read Only",
    description: "Can inspect x402 resources, read receipts and ledger. No payments.",
    allowedTools: [
      "arclayer_x402_inspect",
      "arclayer_receipts",
      "arclayer_spend_ledger",
    ],
    // No runnerRole — SDK-only filter
  },
  {
    id: "x402-agent",
    title: "x402 Agent",
    description: "Can inspect, pay, batch pay x402 resources, read receipts and ledger.",
    allowedTools: [
      "arclayer_x402_inspect",
      "arclayer_x402_pay",
      "arclayer_x402_batch_pay",
      "arclayer_receipts",
      "arclayer_spend_ledger",
    ],
    runnerRole: "x402-agent",
  },
  {
    id: "provider",
    title: "Provider",
    description:
      "Can run ERC-8183 provider jobs, read receipts and ledger. Run-only is default; run-and-submit is explicit opt-in.",
    allowedTools: [
      "arclayer_x402_inspect",
      "arclayer_receipts",
      "arclayer_spend_ledger",
      "arclayer_provider_run_only",
      "arclayer_provider_run_and_submit",
    ],
    runnerRole: "provider",
  },
  {
    id: "evaluator",
    title: "Evaluator",
    description: "Can read receipts and ledger. ERC-8183 evaluator tools (future PR).",
    allowedTools: [
      "arclayer_x402_inspect",
      "arclayer_receipts",
      "arclayer_spend_ledger",
    ],
    runnerRole: "evaluator",
  },
  {
    id: "client",
    title: "Client",
    description: "Can read receipts and ledger. ERC-8183 client tools (future PR).",
    allowedTools: [
      "arclayer_x402_inspect",
      "arclayer_receipts",
      "arclayer_spend_ledger",
    ],
    runnerRole: "client",
  },
];

/**
 * Get the list of allowed tool names for a role,
 * applying deniedTools/allowedTools overrides.
 *
 * Precedence: deniedTools > allowedTools > role preset
 */
export function getArcLayerToolsForRole(
  role: ArcLayerAgentRole,
  overrides?: {
    allowedTools?: string[];
    deniedTools?: string[];
  },
): string[] {
  const preset = ROLE_PRESETS.find((p) => p.id === role);
  if (!preset) {
    throw new Error(`Unknown role: ${role}`);
  }

  let tools = [...preset.allowedTools];

  // Apply allowedTools override (intersect with role preset)
  if (overrides?.allowedTools?.length) {
    tools = tools.filter((t) => overrides.allowedTools!.includes(t));
  }

  // Apply deniedTools override (remove from set)
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
