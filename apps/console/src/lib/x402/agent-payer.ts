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
export type AgentX402Scope = 'homepage' | 'a2a';

export type AgentX402PayerResolution = {
  agentId: string;
  controllerAddress: `0x${string}`;
  payerAddress: `0x${string}`;
  rail: AgentX402Rail;
};

export type PayerMatchResult =
  | { ok: true }
  | { ok: false; status: number; error: string; detail: Record<string, unknown> };

// ── Validation ─────────────────────────────────────────────────────────────

const AGENT_ID_RE = /^[a-zA-Z0-9_-]+$/;
const MAX_AGENT_ID_LENGTH = 128;

/**
 * Validate agentId format. Rejects injection vectors and overly long IDs.
 * @throws Error with code 'invalid_agent_id' if validation fails.
 */
export function validateAgentId(agentId: string): void {
  if (!agentId || typeof agentId !== 'string') {
    throw Object.assign(
      new Error('agentId is required'),
      { code: 'invalid_agent_id' },
    );
  }
  if (agentId.length > MAX_AGENT_ID_LENGTH) {
    throw Object.assign(
      new Error(`agentId exceeds max length (${MAX_AGENT_ID_LENGTH})`),
      { code: 'invalid_agent_id' },
    );
  }
  if (!AGENT_ID_RE.test(agentId)) {
    throw Object.assign(
      new Error('agentId contains invalid characters (allowed: a-z, A-Z, 0-9, _, -)'),
      { code: 'invalid_agent_id' },
    );
  }
}

// ── Resolver ───────────────────────────────────────────────────────────────

/**
 * Resolve the required x402 payer for an agent.
 *
 * 1. Validates agentId format (injection guard).
 * 2. Reads erc8004_agents by agent_id first, then token_id fallback (two separate queries, no .or()).
 * 3. Reads active payer from agent_x402_payers.
 * 4. If missing or revoked → throws. No platform payer fallback.
 *
 * @throws Error with code 'invalid_agent_id' if agentId fails format validation.
 * @throws Error with code 'agent_not_found' if agent doesn't exist in erc8004_agents.
 * @throws Error with code 'agent_x402_payer_not_configured' if no active payer.
 */
export async function resolveRequiredAgentX402Payer(
  agentId: string,
  rail: AgentX402Rail = 'circle-gateway',
  scope: AgentX402Scope = 'homepage',
): Promise<AgentX402PayerResolution> {
  validateAgentId(agentId);

  const supabase = getSupabaseAdmin();

  // Step 1: Resolve agent from erc8004_agents (read-only).
  // Two separate queries to avoid .or() string interpolation with user input.
  // Try agent_id first, then token_id fallback.
  let agent: Record<string, unknown> | null = null;

  const { data: byAgentId, error: byAgentIdError } = await supabase
    .from('erc8004_agents')
    .select('token_id, agent_id, controller')
    .eq('agent_id', agentId)
    .limit(1)
    .maybeSingle();

  if (byAgentIdError) {
    throw Object.assign(
      new Error(`Failed to lookup agent by agent_id: ${byAgentIdError.message}`),
      { code: 'agent_lookup_failed' },
    );
  }

  if (byAgentId) {
    agent = byAgentId;
  } else {
    const { data: byTokenId, error: byTokenIdError } = await supabase
      .from('erc8004_agents')
      .select('token_id, agent_id, controller')
      .eq('token_id', agentId)
      .limit(1)
      .maybeSingle();

    if (byTokenIdError) {
      throw Object.assign(
        new Error(`Failed to lookup agent by token_id: ${byTokenIdError.message}`),
        { code: 'agent_lookup_failed' },
      );
    }

    agent = byTokenId;
  }

  if (!agent) {
    throw Object.assign(
      new Error(`Agent not found: ${agentId}`),
      { code: 'agent_not_found' },
    );
  }

  const canonicalAgentId = String(agent.agent_id ?? agent.token_id ?? agentId);
  const controller = String(agent.controller ?? '');

  // Step 2: Read active payer from agent_x402_payers (always scoped).
  const { data: payerRow, error: payerError } = await supabase
    .from('agent_x402_payers')
    .select('payer_address, rail, scope, status, revoked_at')
    .eq('agent_id', canonicalAgentId)
    .eq('rail', rail)
    .eq('scope', scope)
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

// ── A2A Payer Auto-Binding ────────────────────────────────────────────────

/**
 * Ensure an A2A x402 payer binding exists for an agent.
 *
 * If the agent has an active Agent Account (circleAgentAccountAddress),
 * upserts an `agent_x402_payers` row with:
 *   agentTokenId → payerAddress = circleAgentAccountAddress
 *   rail = circle-gateway, scope = a2a
 *
 * Idempotent: if an active a2a binding already exists with the same payer,
 * returns it. If payer changed, revokes old and inserts new.
 *
 * @returns The active A2A payer binding, or null if no Agent Account provided.
 */
export async function ensureA2aPayerBinding(input: {
  agentId: string;
  controllerAddress: string;
  agentAccountAddress: string;
}): Promise<{ payerAddress: string; rail: AgentX402Rail; scope: AgentX402Scope } | null> {
  if (process.env.AGENT_ACCOUNT_A2A_AUTO_BIND_ENABLED !== 'true') return null;

  const { agentId, controllerAddress, agentAccountAddress } = input;

  if (!agentAccountAddress || !isAddress(agentAccountAddress)) return null;

  const supabase = getSupabaseAdmin();
  const normalizedPayer = getAddress(agentAccountAddress);
  const normalizedController = getAddress(controllerAddress);
  const rail: AgentX402Rail = 'circle-gateway';
  const scope: AgentX402Scope = 'a2a';

  // Check if active a2a binding already exists
  const { data: existing } = await supabase
    .from('agent_x402_payers')
    .select('id, payer_address')
    .eq('agent_id', agentId)
    .eq('rail', rail)
    .eq('scope', scope)
    .eq('status', 'active')
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Already bound to same payer — nothing to do
    const existingPayer = getAddress((existing as Record<string, unknown>).payer_address as string);
    if (existingPayer === normalizedPayer) {
      return { payerAddress: normalizedPayer, rail, scope };
    }
    // Payer changed — revoke old binding
    await supabase
      .from('agent_x402_payers')
      .update({ status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', (existing as Record<string, unknown>).id as string);
  }

  // Insert new a2a binding
  const { error: insertError } = await supabase
    .from('agent_x402_payers')
    .insert({
      agent_id: agentId,
      controller_address: normalizedController,
      payer_address: normalizedPayer,
      rail,
      scope,
      status: 'active',
      verified_at: new Date().toISOString(),
    });

  // Ignore unique violation (concurrent insert race)
  if (insertError && insertError.code !== '23505') {
    throw new Error(`a2a_payer_bind_failed: ${insertError.message}`);
  }

  return { payerAddress: normalizedPayer, rail, scope };
}

/**
 * Get the active A2A x402 payer for an agent (read-only).
 * Returns null if no active a2a binding exists.
 */
export async function getActiveA2aPayer(
  agentId: string,
): Promise<{ payerAddress: string; rail: AgentX402Rail; scope: AgentX402Scope } | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('agent_x402_payers')
    .select('payer_address, rail, scope')
    .eq('agent_id', agentId)
    .eq('rail', 'circle-gateway')
    .eq('scope', 'a2a')
    .eq('status', 'active')
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  return {
    payerAddress: getAddress(row.payer_address as string),
    rail: row.rail as AgentX402Rail,
    scope: row.scope as AgentX402Scope,
  };
}
