/**
 * x402 Per-Agent Payer Resolver — strict binding, no shared payer fallback.
 *
 * Resolves the registered x402 payer EOA for an agent from `agent_x402_payers`.
 * If no active payer is registered, throws — never falls back to a platform payer.
 *
 * Also provides `assertX402PayerMatches` for middleware-level payer verification.
 *
 * Scope: x402 payment layer only. Read-only dependency on erc8004_agents.
 * Does NOT modify ERC-8004 or ERC-8183 logic.
 */

import { getAddress, isAddress } from 'viem';
import { getSupabaseAdmin } from './supabaseClient';

// ── Types ──────────────────────────────────────────────────────────────────

export type AgentX402Rail = 'circle-gateway' | 'arc-native';

export type AgentX402PayerResolution = {
  agentId: string;
  controllerAddress: `0x${string}`;
  payerAddress: `0x${string}`;
  rail: AgentX402Rail;
};

export type PayerMatchResult =
  | { ok: true }
  | { ok: false; status: number; error: string; detail: Record<string, unknown> };

// ── Resolver ───────────────────────────────────────────────────────────────

/**
 * Resolve the required x402 payer for an agent.
 *
 * 1. Reads erc8004_agents by agent_id or token_id (read-only, no modification).
 * 2. Reads active payer from agent_x402_payers.
 * 3. If missing or revoked → throws. No platform payer fallback.
 *
 * @throws Error with code 'agent_x402_payer_not_configured' if no active payer.
 * @throws Error with code 'agent_not_found' if agent doesn't exist in erc8004_agents.
 */
export async function resolveRequiredAgentX402Payer(
  agentId: string,
  rail: AgentX402Rail = 'circle-gateway',
): Promise<AgentX402PayerResolution> {
  const supabase = getSupabaseAdmin();

  // Step 1: Resolve agent from erc8004_agents (read-only).
  // Try agent_id first, then token_id. Use canonical DB agent_id.
  const { data: agent, error: agentError } = await supabase
    .from('erc8004_agents')
    .select('token_id, agent_id, controller')
    .or(`agent_id.eq.${agentId},token_id.eq.${agentId}`)
    .limit(1)
    .maybeSingle();

  if (agentError || !agent) {
    throw Object.assign(
      new Error(`Agent not found: ${agentId}`),
      { code: 'agent_not_found' },
    );
  }

  const canonicalAgentId = String(agent.agent_id ?? agent.token_id ?? agentId);
  const controller = String(agent.controller ?? '');

  // Step 2: Read active payer from agent_x402_payers.
  const { data: payerRow, error: payerError } = await supabase
    .from('agent_x402_payers')
    .select('payer_address, rail, status, revoked_at')
    .eq('agent_id', canonicalAgentId)
    .eq('rail', rail)
    .eq('status', 'active')
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle();

  if (payerError || !payerRow) {
    throw Object.assign(
      new Error(`No active x402 payer registered for agent ${canonicalAgentId} (rail: ${rail}). External agents must register their own payer.`),
      { code: 'agent_x402_payer_not_configured' },
    );
  }

  // Step 3: Normalize addresses.
  const payerAddress = getAddress(payerRow.payer_address);
  const controllerAddress = controller ? getAddress(controller) : ('0x0000000000000000000000000000000000000000' as `0x${string}`);

  return {
    agentId: canonicalAgentId,
    controllerAddress,
    payerAddress: payerAddress as `0x${string}`,
    rail: payerRow.rail as AgentX402Rail,
  };
}

// ── Payer match assertion ──────────────────────────────────────────────────

/**
 * Pure, testable assertion: does the actual payer from a payment proof
 * match the expected registered payer?
 *
 * Rules:
 * - Missing/null actualPayer → x402_payer_missing (400)
 * - Address mismatch → x402_payer_mismatch (403)
 * - Case-insensitive checksum comparison via getAddress()
 * - Match → { ok: true }
 */
export function assertX402PayerMatches(input: {
  actualPayer: string | null | undefined;
  expectedPayer: string;
  agentId: string;
}): PayerMatchResult {
  const { actualPayer, expectedPayer, agentId } = input;

  // Missing payer from payment proof
  if (!actualPayer || typeof actualPayer !== 'string' || actualPayer.trim().length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'x402_payer_missing',
      detail: {
        agentId,
        message: 'Payment proof does not contain a payer address. Cannot verify agent payer binding.',
      },
    };
  }

  // Normalize both addresses to checksum form for case-insensitive comparison
  let normalizedActual: string;
  let normalizedExpected: string;
  try {
    normalizedActual = getAddress(actualPayer);
    normalizedExpected = getAddress(expectedPayer);
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'x402_payer_invalid_address',
      detail: {
        agentId,
        message: 'Payer address is not a valid EVM address.',
      },
    };
  }

  if (normalizedActual !== normalizedExpected) {
    return {
      ok: false,
      status: 403,
      error: 'x402_payer_mismatch',
      detail: {
        agentId,
        actualPayer: normalizedActual,
        expectedPayer: normalizedExpected,
        message: 'Payment payer does not match the registered agent payer. External agents must pay with their own registered EOA.',
      },
    };
  }

  return { ok: true };
}
