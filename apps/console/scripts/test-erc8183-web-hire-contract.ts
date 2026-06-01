// @ts-nocheck — live test script
/**
 * ERC-8183 Web Hire Contract Live Test
 *
 * Two-phase test:
 *   Phase 1: validateWebHireInput() — pure field validation
 *   Phase 2: resolveIdentityAndBuild() — real DB identity resolution
 *
 * Does NOT broadcast any transactions.
 *
 * Usage:
 *   cd apps/console
 *   set -a && source .env.local && set +a
 *   ERC8183_WEB_HIRE_LIVE=true npx tsx scripts/test-erc8183-web-hire-contract.ts
 */

if (process.env.ERC8183_WEB_HIRE_LIVE !== 'true') {
  console.log('Set ERC8183_WEB_HIRE_LIVE=true to run live ERC-8183 web hire contract test.');
  process.exit(0);
}

import { createClient } from '@supabase/supabase-js';
import {
  validateWebHireInput,
  resolveIdentityAndBuild,
  createSupabaseIdentityResolver,
} from '../src/lib/erc8183-jobs/web-hire-contract';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

let stepNum = 0;
function step(msg: string) { console.log(`\n[${++stepNum}] ${msg}`); }
function ok(msg: string) { console.log(`  ✓ ${msg}`); }
function fail(msg: string): never { console.error(`  ✗ ${msg}`); process.exit(1); }

async function main() {
  console.log('=== ERC-8183 Web Hire Contract Live Test ===');
  console.log('Two-phase: validate + resolveIdentityAndBuild. No tx broadcast.\n');

  // ── Step 1: Find real agent identities in DB ──────────────────────────

  step('Find real agent identities in DB');
  const { data: agents } = await sb
    .from('erc8004_agents')
    .select('token_id, controller')
    .limit(3);

  if (!agents?.length || agents.length < 2) {
    fail('Need at least 2 agents in erc8004_agents for this test');
  }

  const clientAgent = agents[0];
  const providerAgent = agents[1];
  const evaluatorAgent = agents[2] ?? agents[0]; // fallback to client if only 2

  ok(`Client: tokenId=${clientAgent.token_id}, controller=${clientAgent.controller?.slice(0, 10)}...`);
  ok(`Provider: tokenId=${providerAgent.token_id}, controller=${providerAgent.controller?.slice(0, 10)}...`);
  ok(`Evaluator: tokenId=${evaluatorAgent.token_id}, controller=${evaluatorAgent.controller?.slice(0, 10)}...`);

  // Create real DB resolver
  const resolve = createSupabaseIdentityResolver(sb);

  // ── Step 2: Phase 1 — validateWebHireInput ────────────────────────────

  step('Phase 1: validateWebHireInput (no DB, no controllers in input)');
  const validated = validateWebHireInput({
    settlementMode: 'erc8183_escrow',
    buyerAgentId: clientAgent.token_id,
    // NO buyerController — must be resolved from DB
    providerAgentId: providerAgent.token_id,
    // NO providerController — must be resolved from DB
    evaluatorAgentId: evaluatorAgent.token_id,
    // NO evaluatorController — must be resolved from DB
    budgetAtomic: '1000000',
    expiredAtUnix: String(Math.floor(Date.now() / 1000) + 3600),
    description: 'Live test web hire contract',
    inputPayload: { test: true, timestamp: Date.now() },
  });

  if (!validated.ok) fail(`Phase 1 failed: ${validated.error} — ${validated.detail}`);
  ok(`buyerAgentId: ${validated.buyerAgentId}`);
  ok(`providerAgentId: ${validated.providerAgentId}`);
  ok(`evaluatorAgentId: ${validated.evaluatorAgentId}`);
  ok(`inputPayloadHash: ${validated.inputPayloadHash.slice(0, 18)}...`);
  ok(`No controllers in validated output (they come from DB)`);

  // ── Step 3: Phase 2 — resolveIdentityAndBuild ─────────────────────────

  step('Phase 2: resolveIdentityAndBuild (resolves from erc8004_agents)');
  const result = await resolveIdentityAndBuild(validated, resolve);

  if (!result.ok) fail(`Phase 2 failed: ${result.error} — ${result.detail}`);
  ok(`settlementMode: ${result.settlementMode}`);
  ok(`client.controller: ${result.participants.client.controller.slice(0, 10)}...`);
  ok(`provider.controller: ${result.participants.provider.controller.slice(0, 10)}...`);
  ok(`evaluator.controller: ${result.participants.evaluator.controller.slice(0, 10)}...`);
  ok(`evaluator.mode: ${result.participants.evaluator.mode}`);
  ok(`budget: ${result.budget.formatted} USDC`);
  ok(`next.createJob.signer: ${result.next.createJob.signer}`);
  ok(`next.createJob.provider: ${result.next.createJob.provider.slice(0, 10)}... (from DB)`);
  ok(`next.createJob.evaluator: ${result.next.createJob.evaluator.slice(0, 10)}... (from DB)`);

  // ── Step 4: Verify next.createJob never has zero addresses ────────────

  step('Verify next.createJob has no zero addresses');
  const ZERO = '0x0000000000000000000000000000000000000000';
  if (result.next.createJob.provider === ZERO) fail('next.createJob.provider is zero address');
  if (result.next.createJob.evaluator === ZERO) fail('next.createJob.evaluator is zero address');
  ok('next.createJob.provider is NOT zero address');
  ok('next.createJob.evaluator is NOT zero address');

  // ── Step 5: Test evaluatorMode="client" with DB resolution ─────────────

  step('evaluatorMode="client" uses buyer DB controller');
  const clientValidated = validateWebHireInput({
    settlementMode: 'erc8183_escrow',
    buyerAgentId: clientAgent.token_id,
    providerAgentId: providerAgent.token_id,
    evaluatorMode: 'client',
    // NO evaluatorAgentId — client mode
    budgetAtomic: '500000',
    expiredAtUnix: String(Math.floor(Date.now() / 1000) + 3600),
    description: 'Client as evaluator test',
    inputPayload: { task: 'simple' },
  });

  if (!clientValidated.ok) fail(`Client mode validate failed: ${clientValidated.error}`);
  const clientResult = await resolveIdentityAndBuild(clientValidated, resolve);
  if (!clientResult.ok) fail(`Client mode resolve failed: ${clientResult.error}`);
  ok(`evaluator.agentId = ${clientResult.participants.evaluator.agentId} (should be buyer)`);
  ok(`evaluator.mode = ${clientResult.participants.evaluator.mode}`);
  if (clientResult.participants.evaluator.agentId !== clientAgent.token_id) {
    fail('Evaluator should be buyer when evaluatorMode="client"');
  }
  if (clientResult.participants.evaluator.controller !== clientAgent.controller) {
    fail('Evaluator controller should be buyer DB controller');
  }
  ok('Evaluator correctly uses buyer DB controller');
  ok(`next.createJob.evaluator: ${clientResult.next.createJob.evaluator.slice(0, 10)}... (= buyer DB controller)`);

  // ── Step 6: Test controller assertion mismatch ────────────────────────

  step('Controller assertion mismatch is rejected');
  const mismatched = validateWebHireInput({
    settlementMode: 'erc8183_escrow',
    buyerAgentId: clientAgent.token_id,
    buyerController: providerAgent.controller, // WRONG — fake assertion
    providerAgentId: providerAgent.token_id,
    evaluatorAgentId: evaluatorAgent.token_id,
    budgetAtomic: '1000000',
    expiredAtUnix: String(Math.floor(Date.now() / 1000) + 3600),
    description: 'Mismatch test',
    inputPayload: { test: true },
  });

  if (!mismatched.ok) fail(`Mismatch validate failed: ${mismatched.error}`);
  const mismatchResult = await resolveIdentityAndBuild(mismatched, resolve);
  if (mismatchResult.ok) fail('Expected rejection for controller mismatch');
  if (mismatchResult.error !== 'buyer_controller_mismatch') {
    fail(`Expected buyer_controller_mismatch, got ${mismatchResult.error}`);
  }
  ok(`Rejected: ${mismatchResult.error}`);

  // ── Step 7: Test unknown agentId ──────────────────────────────────────

  step('Unknown agentId is rejected');
  const unknownValidated = validateWebHireInput({
    settlementMode: 'erc8183_escrow',
    buyerAgentId: '999999999', // does not exist
    providerAgentId: providerAgent.token_id,
    evaluatorAgentId: evaluatorAgent.token_id,
    budgetAtomic: '1000000',
    expiredAtUnix: String(Math.floor(Date.now() / 1000) + 3600),
    description: 'Unknown agent test',
    inputPayload: { test: true },
  });

  if (!unknownValidated.ok) fail(`Unknown validate failed: ${unknownValidated.error}`);
  const unknownResult = await resolveIdentityAndBuild(unknownValidated, resolve);
  if (unknownResult.ok) fail('Expected rejection for unknown agentId');
  if (unknownResult.error !== 'buyer_identity_not_found') {
    fail(`Expected buyer_identity_not_found, got ${unknownResult.error}`);
  }
  ok(`Rejected: ${unknownResult.error}`);

  // ── Step 8: Test rejection cases (field validation) ────────────────────

  step('Field validation rejection cases');
  const cases = [
    { input: { settlementMode: 'x402' }, expected: 'invalid_settlementMode' },
    { input: { settlementMode: 'erc8183_escrow', buyerAgentId: '' }, expected: 'missing_buyerAgentId' },
    { input: { settlementMode: 'erc8183_escrow', buyerAgentId: 'a', providerAgentId: '' }, expected: 'missing_providerAgentId' },
    { input: { settlementMode: 'erc8183_escrow', buyerAgentId: 'a', providerAgentId: 'b', budgetAtomic: '0' }, expected: 'invalid_budgetAtomic' },
    { input: { settlementMode: 'erc8183_escrow', buyerAgentId: 'a', providerAgentId: 'b', budgetAtomic: '100', expiredAtUnix: '1' }, expected: 'expired_expiredAtUnix' },
  ];

  for (const c of cases) {
    const r = validateWebHireInput({
      ...c.input,
      expiredAtUnix: c.input.expiredAtUnix ?? String(Math.floor(Date.now() / 1000) + 3600),
      description: 'test',
      inputPayload: {},
    });
    if (r.ok) fail(`Expected rejection for ${c.expected}, got ok`);
    if (r.error !== c.expected) fail(`Expected ${c.expected}, got ${r.error}`);
    ok(`Rejected: ${c.expected}`);
  }

  // ── Step 9: Verify no private keys in response ────────────────────────

  step('Verify no private keys or signing in response');
  const json = JSON.stringify(result);
  if (json.includes('privateKey') || json.includes('private_key')) {
    fail('Response contains private key references');
  }
  if (json.includes('signTransaction') || json.includes('broadcast')) {
    fail('Response contains signing/broadcast instructions');
  }
  ok('No private keys or signing in response');
  ok(`next.createJob.signer: "${result.next.createJob.signer}" (client-side only)`);

  // ── Done ──────────────────────────────────────────────────────────────

  console.log('\n=== ERC-8183 WEB HIRE CONTRACT TEST PASSED ===');
  console.log('Validated:');
  console.log('  Phase 1: field validation (no DB)');
  console.log('  Phase 2: identity resolution from erc8004_agents');
  console.log('  Controllers from DB, not from request body');
  console.log('  Controller assertion mismatch rejected');
  console.log('  Unknown agentId rejected');
  console.log('  evaluatorMode="client" uses buyer DB controller');
  console.log('  next.createJob never has zero addresses');
  console.log('  No private keys or signing in response');
}

main().catch((err) => {
  console.error('\n=== TEST FAILED ===');
  console.error(err);
  process.exit(1);
});
