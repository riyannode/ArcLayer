/**
 * ERC-8183 Web Hire Contract Tests
 *
 * Two-phase testing:
 *   Phase 1: validateWebHireInput() — pure field validation, no DB
 *   Phase 2: resolveIdentityAndBuild() — identity resolution from mock DB
 */

import { describe, it, expect } from 'vitest';
import {
  validateWebHireInput,
  resolveIdentityAndBuild,
  type WebHireInput,
  type ValidatedWebHireInput,
  type WebHireResponse,
  type IdentityResolver,
} from './web-hire-contract';

// ── Test fixtures ─────────────────────────────────────────────────────────

const BUYER_AGENT = 'buyer-001';
const BUYER_CTRL = '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20';
const PROVIDER_AGENT = 'provider-001';
const PROVIDER_CTRL = '0xb03141849F755b0a337b3352C2290fce66e0C6dD';
const EVALUATOR_AGENT = 'evaluator-001';
const EVALUATOR_CTRL = '0x0380542Fd05813461A71e9Befb80fBeA0AE656E8';

/** Mock identity resolver — maps agentId to controller. */
function mockResolver(db: Record<string, string>): IdentityResolver {
  return async (agentId: string) => db[agentId] ?? null;
}

function validInput(overrides: Partial<WebHireInput> = {}): WebHireInput {
  return {
    settlementMode: 'erc8183_escrow',
    buyerAgentId: BUYER_AGENT,
    providerAgentId: PROVIDER_AGENT,
    evaluatorAgentId: EVALUATOR_AGENT,
    budgetAtomic: '2000000',
    expiredAtUnix: String(Math.floor(Date.now() / 1000) + 3600),
    description: 'Test hire request',
    inputPayload: { task: 'analyze', data: [1, 2, 3] },
    ...overrides,
  };
}

const FULL_DB: Record<string, string> = {
  [BUYER_AGENT]: BUYER_CTRL,
  [PROVIDER_AGENT]: PROVIDER_CTRL,
  [EVALUATOR_AGENT]: EVALUATOR_CTRL,
};

// Helper: validate + resolve with full DB
async function prepareOk(
  inputOverrides: Partial<WebHireInput> = {},
  dbOverrides: Record<string, string> = {},
): Promise<WebHireResponse> {
  const validated = validateWebHireInput(validInput(inputOverrides));
  if (!validated.ok) throw new Error(`validate failed: ${validated.error}`);
  const db = { ...FULL_DB, ...dbOverrides };
  const result = await resolveIdentityAndBuild(validated, mockResolver(db));
  if (!result.ok) throw new Error(`resolve failed: ${result.error} — ${result.detail}`);
  return result;
}

// ── Phase 1: validateWebHireInput() ───────────────────────────────────────

describe('Phase 1: validateWebHireInput (pure field validation)', () => {
  // ── Valid inputs ──────────────────────────────────────────────────────

  it('valid input returns ValidatedWebHireInput with all fields', () => {
    const result = validateWebHireInput(validInput());
    expect(result.ok).not.toBe(false);
    const v = result as ValidatedWebHireInput;
    expect(v.buyerAgentId).toBe(BUYER_AGENT);
    expect(v.providerAgentId).toBe(PROVIDER_AGENT);
    expect(v.evaluatorAgentId).toBe(EVALUATOR_AGENT);
    expect(v.evaluatorMode).toBe('explicit');
    expect(v.budgetAtomic).toBe('2000000');
    expect(v.budget).toBe(BigInt(2000000));
    expect(v.description).toBe('Test hire request');
    expect(v.inputPayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(v.expiredAtUnix).toBeDefined();
    expect(v.hook).toBe('0x0000000000000000000000000000000000000000');
  });

  it('input without controllers is valid (controllers are assertions only)', () => {
    const result = validateWebHireInput(validInput({
      buyerController: undefined,
      providerController: undefined,
      evaluatorController: undefined,
    }));
    expect(result.ok).not.toBe(false);
    const v = result as ValidatedWebHireInput;
    expect(v.buyerControllerAssertion).toBeUndefined();
    expect(v.providerControllerAssertion).toBeUndefined();
    expect(v.evaluatorControllerAssertion).toBeUndefined();
  });

  it('valid controller assertions are preserved', () => {
    const result = validateWebHireInput(validInput({
      buyerController: BUYER_CTRL,
      providerController: PROVIDER_CTRL,
      evaluatorController: EVALUATOR_CTRL,
    }));
    expect(result.ok).not.toBe(false);
    const v = result as ValidatedWebHireInput;
    expect(v.buyerControllerAssertion).toBe(BUYER_CTRL);
    expect(v.providerControllerAssertion).toBe(PROVIDER_CTRL);
    expect(v.evaluatorControllerAssertion).toBe(EVALUATOR_CTRL);
  });

  // ── Evaluator mode ────────────────────────────────────────────────────

  it('evaluatorMode="client" sets evaluatorAgentId = buyerAgentId', () => {
    const result = validateWebHireInput(validInput({
      evaluatorMode: 'client',
      evaluatorAgentId: undefined,
      evaluatorController: undefined,
    }));
    expect(result.ok).not.toBe(false);
    const v = result as ValidatedWebHireInput;
    expect(v.evaluatorAgentId).toBe(BUYER_AGENT);
    expect(v.evaluatorMode).toBe('client');
  });

  it('evaluatorMode="explicit" without evaluatorAgentId returns error', () => {
    const result = validateWebHireInput(validInput({
      evaluatorMode: 'explicit',
      evaluatorAgentId: undefined,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('missing_evaluatorAgentId');
  });

  // ── Validation errors ─────────────────────────────────────────────────

  it('invalid settlementMode rejected', () => {
    const result = validateWebHireInput(validInput({ settlementMode: 'x402' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_settlementMode');
  });

  it('missing buyerAgentId rejected', () => {
    const result = validateWebHireInput(validInput({ buyerAgentId: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('missing_buyerAgentId');
  });

  it('missing providerAgentId rejected', () => {
    const result = validateWebHireInput(validInput({ providerAgentId: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('missing_providerAgentId');
  });

  it('invalid budgetAtomic rejected (non-numeric)', () => {
    const result = validateWebHireInput(validInput({ budgetAtomic: 'abc' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_budgetAtomic');
  });

  it('invalid budgetAtomic rejected (zero)', () => {
    const result = validateWebHireInput(validInput({ budgetAtomic: '0' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_budgetAtomic');
  });

  it('invalid budgetAtomic rejected (negative)', () => {
    const result = validateWebHireInput(validInput({ budgetAtomic: '-100' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_budgetAtomic');
  });

  it('expired expiredAtUnix rejected', () => {
    const past = String(Math.floor(Date.now() / 1000) - 3600);
    const result = validateWebHireInput(validInput({ expiredAtUnix: past }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('expired_expiredAtUnix');
  });

  it('description too long rejected', () => {
    const longDesc = 'x'.repeat(2049);
    const result = validateWebHireInput(validInput({ description: longDesc }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('description_too_long');
  });

  it('invalid inputPayload rejected (array)', () => {
    const result = validateWebHireInput(validInput({ inputPayload: [1, 2, 3] as any }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_inputPayload');
  });

  it('invalid evaluatorMode rejected', () => {
    const result = validateWebHireInput(validInput({ evaluatorMode: 'auto' as any }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_evaluatorMode');
  });

  it('invalid buyerController format rejected', () => {
    const result = validateWebHireInput(validInput({ buyerController: 'not-an-address' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_buyerController');
  });

  it('invalid providerController format rejected', () => {
    const result = validateWebHireInput(validInput({ providerController: '0xBAD' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_providerController');
  });

  // ── Deterministic hash ────────────────────────────────────────────────

  it('deterministic inputPayloadHash stable across calls', () => {
    const r1 = validateWebHireInput(validInput());
    const r2 = validateWebHireInput(validInput());
    expect((r1 as ValidatedWebHireInput).inputPayloadHash).toBe(
      (r2 as ValidatedWebHireInput).inputPayloadHash,
    );
  });

  it('different payloads produce different hashes', () => {
    const r1 = validateWebHireInput(validInput({ inputPayload: { a: 1 } }));
    const r2 = validateWebHireInput(validInput({ inputPayload: { a: 2 } }));
    expect((r1 as ValidatedWebHireInput).inputPayloadHash).not.toBe(
      (r2 as ValidatedWebHireInput).inputPayloadHash,
    );
  });

  it('stable hash ignores key order', () => {
    const r1 = validateWebHireInput(validInput({ inputPayload: { b: 2, a: 1 } }));
    const r2 = validateWebHireInput(validInput({ inputPayload: { a: 1, b: 2 } }));
    expect((r1 as ValidatedWebHireInput).inputPayloadHash).toBe(
      (r2 as ValidatedWebHireInput).inputPayloadHash,
    );
  });
});

// ── Phase 2: resolveIdentityAndBuild() ────────────────────────────────────

describe('Phase 2: resolveIdentityAndBuild (identity resolution)', () => {
  // ── Successful resolution ─────────────────────────────────────────────

  it('valid 3-agent hire resolves all controllers from DB', async () => {
    const result = await prepareOk();
    expect(result.participants.client.controller).toBe(BUYER_CTRL);
    expect(result.participants.provider.controller).toBe(PROVIDER_CTRL);
    expect(result.participants.evaluator.controller).toBe(EVALUATOR_CTRL);
    expect(result.participants.evaluator.mode).toBe('explicit');
  });

  it('next.createJob.provider and evaluator are DB controllers, not body', async () => {
    const result = await prepareOk();
    expect(result.next.createJob.provider).toBe(PROVIDER_CTRL);
    expect(result.next.createJob.evaluator).toBe(EVALUATOR_CTRL);
    expect(result.next.createJob.signer).toBe('client');
  });

  it('response contains expected shape', async () => {
    const result = await prepareOk();
    expect(result.ok).toBe(true);
    expect(result.settlementMode).toBe('erc8183_escrow');
    expect(result.budget.atomic).toBe('2000000');
    expect(result.budget.decimals).toBe(6);
    expect(result.budget.formatted).toBe('2.000000');
    expect(result.inputPayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.description).toBe('Test hire request');
    expect(result.next.createJob.expiredAt).toBeDefined();
    expect(result.next.createJob.hook).toBe('0x0000000000000000000000000000000000000000');
  });

  // ── Missing controller from body is fine if DB has identity ────────────

  it('missing providerController from body still succeeds if DB identity exists', async () => {
    const result = await prepareOk({ providerController: undefined });
    expect(result.participants.provider.controller).toBe(PROVIDER_CTRL);
    expect(result.next.createJob.provider).toBe(PROVIDER_CTRL);
  });

  it('missing buyerController from body still succeeds if DB identity exists', async () => {
    const result = await prepareOk({ buyerController: undefined });
    expect(result.participants.client.controller).toBe(BUYER_CTRL);
  });

  it('missing evaluatorController from body still succeeds if DB identity exists', async () => {
    const result = await prepareOk({ evaluatorController: undefined });
    expect(result.participants.evaluator.controller).toBe(EVALUATOR_CTRL);
  });

  // ── Fake controller assertion is rejected ──────────────────────────────

  it('fake buyerController assertion is rejected (mismatch)', async () => {
    const validated = validateWebHireInput(validInput({
      buyerController: PROVIDER_CTRL, // wrong — pretending provider is buyer
    }));
    if (!validated.ok) throw new Error('validate failed');
    const result = await resolveIdentityAndBuild(validated, mockResolver(FULL_DB));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('buyer_controller_mismatch');
  });

  it('fake providerController assertion is rejected (mismatch)', async () => {
    const validated = validateWebHireInput(validInput({
      providerController: BUYER_CTRL, // wrong
    }));
    if (!validated.ok) throw new Error('validate failed');
    const result = await resolveIdentityAndBuild(validated, mockResolver(FULL_DB));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('provider_controller_mismatch');
  });

  it('fake evaluatorController assertion is rejected (mismatch)', async () => {
    const validated = validateWebHireInput(validInput({
      evaluatorController: BUYER_CTRL, // wrong
    }));
    if (!validated.ok) throw new Error('validate failed');
    const result = await resolveIdentityAndBuild(validated, mockResolver(FULL_DB));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('evaluator_controller_mismatch');
  });

  // ── Unknown agentId rejected ──────────────────────────────────────────

  it('unknown buyerAgentId returns buyer_identity_not_found', async () => {
    const validated = validateWebHireInput(validInput({ buyerAgentId: 'unknown-buyer' }));
    if (!validated.ok) throw new Error('validate failed');
    const result = await resolveIdentityAndBuild(validated, mockResolver(FULL_DB));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('buyer_identity_not_found');
  });

  it('unknown providerAgentId returns provider_identity_not_found', async () => {
    const validated = validateWebHireInput(validInput({ providerAgentId: 'unknown-provider' }));
    if (!validated.ok) throw new Error('validate failed');
    const result = await resolveIdentityAndBuild(validated, mockResolver(FULL_DB));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('provider_identity_not_found');
  });

  it('unknown evaluatorAgentId returns evaluator_identity_not_found', async () => {
    const validated = validateWebHireInput(validInput({ evaluatorAgentId: 'unknown-eval' }));
    if (!validated.ok) throw new Error('validate failed');
    const result = await resolveIdentityAndBuild(validated, mockResolver(FULL_DB));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('evaluator_identity_not_found');
  });

  // ── evaluatorMode="client" uses buyer DB controller ────────────────────

  it('evaluatorMode="client" uses buyer DB controller for evaluator', async () => {
    const result = await prepareOk({
      evaluatorMode: 'client',
      evaluatorAgentId: undefined,
      evaluatorController: undefined,
    });
    expect(result.participants.evaluator.agentId).toBe(BUYER_AGENT);
    expect(result.participants.evaluator.controller).toBe(BUYER_CTRL);
    expect(result.participants.evaluator.mode).toBe('client');
    expect(result.next.createJob.evaluator).toBe(BUYER_CTRL);
  });

  it('evaluatorMode="client" with explicit evaluatorController still uses buyer DB controller', async () => {
    // Even if body says evaluatorController = EVALUATOR_CTRL, client mode must use buyer's
    const result = await prepareOk({
      evaluatorMode: 'client',
      evaluatorAgentId: undefined,
      evaluatorController: EVALUATOR_CTRL, // assertion — but mode=client ignores it
    });
    expect(result.participants.evaluator.controller).toBe(BUYER_CTRL);
    expect(result.next.createJob.evaluator).toBe(BUYER_CTRL);
  });

  // ── next.createJob never contains zero address ────────────────────────

  it('next.createJob.provider is never zero address', async () => {
    const result = await prepareOk();
    expect(result.next.createJob.provider).not.toBe('0x0000000000000000000000000000000000000000');
    expect(result.next.createJob.provider).toBe(PROVIDER_CTRL);
  });

  it('next.createJob.evaluator is never zero address', async () => {
    const result = await prepareOk();
    expect(result.next.createJob.evaluator).not.toBe('0x0000000000000000000000000000000000000000');
    expect(result.next.createJob.evaluator).toBe(EVALUATOR_CTRL);
  });

  it('next.createJob.evaluator is never zero address even in client mode', async () => {
    const result = await prepareOk({
      evaluatorMode: 'client',
      evaluatorAgentId: undefined,
      evaluatorController: undefined,
    });
    expect(result.next.createJob.evaluator).not.toBe('0x0000000000000000000000000000000000000000');
    expect(result.next.createJob.evaluator).toBe(BUYER_CTRL);
  });

  // ── No tx behavior ────────────────────────────────────────────────────

  it('response contains no private keys or signing instructions', async () => {
    const result = await prepareOk();
    const json = JSON.stringify(result);
    expect(json).not.toContain('privateKey');
    expect(json).not.toContain('private_key');
    expect(json).not.toContain('signTransaction');
    expect(json).not.toContain('broadcast');
  });

  it('next.createJob.signer is always "client"', async () => {
    const result = await prepareOk();
    expect(result.next.createJob.signer).toBe('client');
  });
});
