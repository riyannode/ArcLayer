/**
 * ERC-8183 Web Hire Contract
 *
 * Validates and normalizes web hire/import input for ERC-8183 escrow jobs.
 * Produces deterministic inputPayloadHash and safe next-step instructions.
 *
 * Two-phase design:
 *   1. validateWebHireInput() — pure field validation (no DB, no identity)
 *   2. resolveIdentityAndBuild() — resolves agentId → controller from DB,
 *      asserts optional body-supplied controllers, builds final response
 *
 * Never signs transactions. Never reads private keys.
 * Never mutates x402 state. API contract + validation only.
 */

import { createHash } from 'node:crypto';
import { isAddress, getAddress } from 'viem';

// ── Types ─────────────────────────────────────────────────────────────────

/** Raw request body (controllers are optional assertions only). */
export interface WebHireInput {
  settlementMode: string;
  buyerAgentId: string;
  buyerController?: string;
  providerAgentId: string;
  providerController?: string;
  evaluatorAgentId?: string;
  evaluatorController?: string;
  evaluatorMode?: 'explicit' | 'client';
  budgetAtomic: string;
  expiredAtUnix: string;
  description: string;
  hookAddress?: string;
  inputPayload: Record<string, unknown>;
}

/** Intermediate result after field validation (no identity resolution yet). */
export interface ValidatedWebHireInput {
  ok: true;
  buyerAgentId: string;
  buyerControllerAssertion?: string;
  providerAgentId: string;
  providerControllerAssertion?: string;
  evaluatorAgentId: string;
  evaluatorControllerAssertion?: string;
  evaluatorMode: 'explicit' | 'client';
  budgetAtomic: string;
  budget: bigint;
  expiredAtUnix: string;
  expiredAt: number;
  description: string;
  hook: string;
  inputPayloadHash: string;
}

export interface WebHireParticipant {
  agentId: string;
  controller: string;
}

export interface WebHireResponse {
  ok: true;
  settlementMode: 'erc8183_escrow';
  participants: {
    client: WebHireParticipant;
    provider: WebHireParticipant;
    evaluator: WebHireParticipant & { mode: 'explicit' | 'client' };
  };
  budget: {
    atomic: string;
    decimals: 6;
    formatted: string;
  };
  expiry: {
    expiredAtUnix: string;
    isExpired: boolean;
  };
  inputPayloadHash: string;
  description: string;
  next: {
    createJob: {
      signer: 'client';
      provider: string;
      evaluator: string;
      expiredAt: string;
      description: string;
      hook: string;
    };
  };
}

export interface WebHireError {
  ok: false;
  error: string;
  detail: string;
}

export type WebHireResult = WebHireResponse | WebHireError;

/** Resolver: given agentId, return controller from DB or null if not found. */
export type IdentityResolver = (agentId: string) => Promise<string | null>;
export type AgentAccountControllerResolver = (controller: string) => Promise<unknown | null>;

// ── Helpers ───────────────────────────────────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${entries.join(',')}}`;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function parseAddress(addr: string | undefined, field: string): string | null {
  if (!addr) return null;
  const trimmed = addr.trim();
  if (!isAddress(trimmed)) {
    throw new Error(`invalid_address:${field}`);
  }
  return getAddress(trimmed);
}

// ── Phase 1: Pure field validation (no DB) ────────────────────────────────

export function validateWebHireInput(
  input: unknown,
): ValidatedWebHireInput | WebHireError {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'invalid_body', detail: 'Request body must be a JSON object' };
  }

  const body = input as Record<string, unknown>;

  // Settlement mode
  if (body.settlementMode !== 'erc8183_escrow') {
    return {
      ok: false,
      error: 'invalid_settlementMode',
      detail: 'settlementMode must be "erc8183_escrow"',
    };
  }

  // Buyer (required)
  if (!body.buyerAgentId || typeof body.buyerAgentId !== 'string') {
    return { ok: false, error: 'missing_buyerAgentId', detail: 'buyerAgentId is required' };
  }

  // Provider (required)
  if (!body.providerAgentId || typeof body.providerAgentId !== 'string') {
    return { ok: false, error: 'missing_providerAgentId', detail: 'providerAgentId is required' };
  }

  // Budget (required, positive integer string)
  if (!body.budgetAtomic || typeof body.budgetAtomic !== 'string') {
    return { ok: false, error: 'missing_budgetAtomic', detail: 'budgetAtomic is required as a string' };
  }
  let budget: bigint;
  try {
    budget = BigInt(body.budgetAtomic as string);
  } catch {
    return { ok: false, error: 'invalid_budgetAtomic', detail: 'budgetAtomic must be a valid integer string' };
  }
  if (budget <= BigInt(0)) {
    return { ok: false, error: 'invalid_budgetAtomic', detail: 'budgetAtomic must be positive' };
  }

  // Expiry (required, must be in the future)
  if (!body.expiredAtUnix || typeof body.expiredAtUnix !== 'string') {
    return { ok: false, error: 'missing_expiredAtUnix', detail: 'expiredAtUnix is required as a string' };
  }
  const expiredAt = Number(body.expiredAtUnix);
  if (!Number.isFinite(expiredAt) || expiredAt <= 0) {
    return { ok: false, error: 'invalid_expiredAtUnix', detail: 'expiredAtUnix must be a positive number' };
  }
  if (expiredAt <= Date.now() / 1000) {
    return { ok: false, error: 'expired_expiredAtUnix', detail: 'expiredAtUnix must be in the future' };
  }

  // Description (required, max 2KB)
  if (!body.description || typeof body.description !== 'string') {
    return { ok: false, error: 'missing_description', detail: 'description is required' };
  }
  if (body.description.length > 2048) {
    return { ok: false, error: 'description_too_long', detail: 'description must be <= 2048 characters' };
  }

  // Input payload (required, must be object)
  if (!body.inputPayload || typeof body.inputPayload !== 'object' || Array.isArray(body.inputPayload)) {
    return { ok: false, error: 'invalid_inputPayload', detail: 'inputPayload must be a JSON object' };
  }

  // Evaluator mode
  const evaluatorMode = (body.evaluatorMode as string) || 'explicit';
  if (!['explicit', 'client'].includes(evaluatorMode)) {
    return {
      ok: false,
      error: 'invalid_evaluatorMode',
      detail: 'evaluatorMode must be "explicit" or "client"',
    };
  }

  // Evaluator agentId (required for explicit mode)
  let evaluatorAgentId: string;
  if (evaluatorMode === 'client') {
    evaluatorAgentId = body.buyerAgentId as string;
  } else {
    if (!body.evaluatorAgentId || typeof body.evaluatorAgentId !== 'string') {
      return {
        ok: false,
        error: 'missing_evaluatorAgentId',
        detail: 'evaluatorAgentId is required when evaluatorMode="explicit"',
      };
    }
    evaluatorAgentId = body.evaluatorAgentId as string;
  }

  // Validate optional controller assertions (reject invalid format, but don't require)
  let buyerControllerAssertion: string | undefined;
  try {
    buyerControllerAssertion = parseAddress(body.buyerController as string, 'buyerController') ?? undefined;
  } catch (e) {
    return { ok: false, error: 'invalid_buyerController', detail: (e as Error).message };
  }

  let providerControllerAssertion: string | undefined;
  try {
    providerControllerAssertion = parseAddress(body.providerController as string, 'providerController') ?? undefined;
  } catch (e) {
    return { ok: false, error: 'invalid_providerController', detail: (e as Error).message };
  }

  let evaluatorControllerAssertion: string | undefined;
  try {
    evaluatorControllerAssertion = parseAddress(body.evaluatorController as string, 'evaluatorController') ?? undefined;
  } catch (e) {
    return { ok: false, error: 'invalid_evaluatorController', detail: (e as Error).message };
  }

  // Hook address
  let hook = '0x0000000000000000000000000000000000000000';
  if (body.hookAddress && typeof body.hookAddress === 'string') {
    try {
      hook = getAddress(body.hookAddress.trim());
    } catch {
      return { ok: false, error: 'invalid_hookAddress', detail: 'hookAddress must be a valid EVM address' };
    }
  }

  // Deterministic inputPayloadHash
  const inputPayloadHash = sha256Hex(stableStringify(body.inputPayload));

  return {
    ok: true,
    buyerAgentId: body.buyerAgentId as string,
    buyerControllerAssertion,
    providerAgentId: body.providerAgentId as string,
    providerControllerAssertion,
    evaluatorAgentId,
    evaluatorControllerAssertion,
    evaluatorMode: evaluatorMode as 'explicit' | 'client',
    budgetAtomic: body.budgetAtomic as string,
    budget,
    expiredAtUnix: body.expiredAtUnix as string,
    expiredAt,
    description: body.description as string,
    hook,
    inputPayloadHash,
  };
}

// ── Phase 2: Identity resolution + response build ─────────────────────────

/**
 * Resolve agentId → controller from DB for each participant.
 * Body-supplied controllers are treated as optional assertions.
 * Returns identity errors or the final WebHireResponse.
 *
 * @param validated — output of validateWebHireInput()
 * @param resolve — async function that queries erc8004_agents by agentId
 */
export async function resolveIdentityAndBuild(
  validated: ValidatedWebHireInput,
  resolve: IdentityResolver,
  resolveAgentAccountController?: AgentAccountControllerResolver,
): Promise<WebHireResult> {
  // 1. Resolve buyer controller
  const buyerController = await resolve(validated.buyerAgentId);
  if (!buyerController) {
    return {
      ok: false,
      error: 'buyer_identity_not_found',
      detail: `No ERC-8004 identity found for buyerAgentId "${validated.buyerAgentId}"`,
    };
  }
  // Assertion check
  if (validated.buyerControllerAssertion && validated.buyerControllerAssertion !== buyerController) {
    return {
      ok: false,
      error: 'buyer_controller_mismatch',
      detail: `buyerController assertion "${validated.buyerControllerAssertion}" does not match DB controller "${buyerController}"`,
    };
  }

  // 2. Resolve provider controller
  const providerController = await resolve(validated.providerAgentId);
  if (!providerController) {
    return {
      ok: false,
      error: 'provider_identity_not_found',
      detail: `No ERC-8004 identity found for providerAgentId "${validated.providerAgentId}"`,
    };
  }
  if (validated.providerControllerAssertion && validated.providerControllerAssertion !== providerController) {
    return {
      ok: false,
      error: 'provider_controller_mismatch',
      detail: `providerController assertion "${validated.providerControllerAssertion}" does not match DB controller "${providerController}"`,
    };
  }

  // 3. Resolve evaluator controller
  let evaluatorController: string;
  let evaluatorMode: 'explicit' | 'client' = validated.evaluatorMode;

  if (validated.evaluatorMode === 'client') {
    // Evaluator = buyer — must use buyer's resolved DB controller
    evaluatorController = buyerController;
  } else {
    const resolvedEvaluator = await resolve(validated.evaluatorAgentId);
    if (!resolvedEvaluator) {
      return {
        ok: false,
        error: 'evaluator_identity_not_found',
        detail: `No ERC-8004 identity found for evaluatorAgentId "${validated.evaluatorAgentId}"`,
      };
    }
    evaluatorController = resolvedEvaluator;
    if (validated.evaluatorControllerAssertion && validated.evaluatorControllerAssertion !== evaluatorController) {
      return {
        ok: false,
        error: 'evaluator_controller_mismatch',
        detail: `evaluatorController assertion "${validated.evaluatorControllerAssertion}" does not match DB controller "${evaluatorController}"`,
      };
    }
  }

  if (process.env.AGENT_ACCOUNT_BACKEND_ENABLED !== 'true' && resolveAgentAccountController) {
    const providerAgentAccount = await resolveAgentAccountController(providerController);
    if (providerAgentAccount) {
      return {
        ok: false,
        error: 'agent_account_controller_disabled',
        detail: 'This agent is controlled by Agent Account. Select or register an EOA-controlled agent for ERC-8183 jobs.',
      };
    }

    const evaluatorAgentAccount = await resolveAgentAccountController(evaluatorController);
    if (evaluatorAgentAccount) {
      return {
        ok: false,
        error: 'agent_account_controller_disabled',
        detail: 'This agent is controlled by Agent Account. Select or register an EOA-controlled agent for ERC-8183 jobs.',
      };
    }
  }

  // 4. Budget formatting
  const budgetFormatted = (Number(validated.budget) / 1_000_000).toFixed(6);
  const isExpired = Date.now() / 1000 > validated.expiredAt;

  // 5. Build response — controllers ALWAYS from DB, never from body
  return {
    ok: true,
    settlementMode: 'erc8183_escrow',
    participants: {
      client: {
        agentId: validated.buyerAgentId,
        controller: buyerController,
      },
      provider: {
        agentId: validated.providerAgentId,
        controller: providerController,
      },
      evaluator: {
        agentId: validated.evaluatorAgentId,
        controller: evaluatorController,
        mode: evaluatorMode,
      },
    },
    budget: {
      atomic: validated.budgetAtomic,
      decimals: 6,
      formatted: budgetFormatted,
    },
    expiry: {
      expiredAtUnix: validated.expiredAtUnix,
      isExpired,
    },
    inputPayloadHash: validated.inputPayloadHash,
    description: validated.description,
    next: {
      createJob: {
        signer: 'client',
        provider: providerController,   // always from DB
        evaluator: evaluatorController,  // always from DB
        expiredAt: validated.expiredAtUnix,
        description: validated.description,
        hook: validated.hook,
      },
    },
  };
}

// ── Supabase identity resolver ────────────────────────────────────────────

/** Minimal Supabase-like client interface for identity resolution. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseQueryClient = any;

/**
 * Create an IdentityResolver backed by Supabase erc8004_agents table.
 * Looks up by token_id = agentId.
 */
export function createSupabaseIdentityResolver(
  supabase: SupabaseQueryClient,
): IdentityResolver {
  return async (agentId: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from('erc8004_agents')
      .select('controller')
      .eq('token_id', agentId)
      .maybeSingle();

    if (error || !data) return null;
    return data.controller as string;
  };
}
