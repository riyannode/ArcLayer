// @ts-nocheck — live test script
/**
 * ERC-8183 Read Model + Reconcile Live Test
 *
 * Tests the production read model and reconcile against a real
 * on-chain ERC-8183 job (created in PR #403 smoke test).
 *
 * Usage:
 *   cd apps/console
 *   set -a && source .env.local && set +a
 *   ERC8183_READMODEL_LIVE=true npx tsx scripts/test-erc8183-read-model.ts
 */

if (process.env.ERC8183_READMODEL_LIVE !== 'true') {
  console.log('Set ERC8183_READMODEL_LIVE=true to run live ERC-8183 read model test.');
  process.exit(0);
}

import { createClient } from '@supabase/supabase-js';
import {
  buildErc8183JobDetail,
  normalizeErc8183LifecycleStatus,
  buildErc8183Timeline,
  buildAllowedActions,
} from '../src/lib/erc8183-jobs/read-model';
import { reconcileErc8183Job } from '../src/lib/erc8183-jobs/reconcile';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

let stepNum = 0;
function step(msg: string) { console.log(`\n[${++stepNum}] ${msg}`); }
function ok(msg: string) { console.log(`  ✓ ${msg}`); }
function fail(msg: string): never { console.error(`  ✗ ${msg}`); process.exit(1); }

async function main() {
  console.log('=== ERC-8183 Read Model + Reconcile Live Test ===\n');

  // ── Find a completed job from PR #403 smoke test ──────────────────────

  step('Find a completed ERC-8183 job with all tx hashes');
  const { data: jobs, error } = await sb
    .from('agent_jobs')
    .select('job_id, erc8183_job_id, erc8183_status, status')
    .eq('settlement_mode', 'erc8183_escrow')
    .eq('erc8183_status', 'Completed')
    .not('approve_tx_hash', 'is', null)
    .not('fund_tx_hash', 'is', null)
    .not('submit_tx_hash', 'is', null)
    .not('complete_tx_hash', 'is', null)
    .limit(1);

  if (error || !jobs?.length) fail('No completed ERC-8183 job found');
  const testJob = jobs[0];
  ok(`Found job: ${testJob.job_id} (on-chain: ${testJob.erc8183_job_id})`);

  // ── Test buildErc8183JobDetail ────────────────────────────────────────

  step('buildErc8183JobDetail()');
  const detail = await buildErc8183JobDetail(testJob.job_id);
  if (!detail) fail('buildErc8183JobDetail returned null');

  ok(`localJobId: ${detail.localJobId}`);
  ok(`erc8183JobId: ${detail.erc8183JobId}`);
  ok(`lifecycleStatus: ${detail.lifecycleStatus}`);
  ok(`localStatus: ${detail.localStatus}`);
  ok(`onchainStatus: ${detail.onchainStatus}`);
  ok(`settlementMode: ${detail.settlementMode}`);

  // Verify lifecycle status is terminal
  if (!['Completed', 'Settled'].includes(detail.lifecycleStatus)) {
    fail(`Expected Completed/Settled, got ${detail.lifecycleStatus}`);
  }
  ok('Lifecycle status is terminal (Completed/Settled)');

  // ── Verify participants ───────────────────────────────────────────────

  step('Verify participants');
  ok(`client: ${detail.participants.client.agentId} @ ${detail.participants.client.address?.slice(0, 10)}...`);
  ok(`provider: ${detail.participants.provider.agentId} @ ${detail.participants.provider.address?.slice(0, 10)}...`);
  ok(`evaluator: ${detail.participants.evaluator.agentId} @ ${detail.participants.evaluator.address?.slice(0, 10)}...`);
  ok(`worker: ${detail.participants.worker.agentId}`);

  // ── Verify budget ─────────────────────────────────────────────────────

  step('Verify budget');
  ok(`atomic: ${detail.budget.atomic}`);
  ok(`formatted: ${detail.budget.formatted} USDC`);
  ok(`decimals: ${detail.budget.decimals}`);

  // ── Verify tx hashes ──────────────────────────────────────────────────

  step('Verify tx hashes');
  const txFields = [
    ['createTxHash', detail.txHashes.createTxHash],
    ['setBudgetTxHash', detail.txHashes.setBudgetTxHash],
    ['approveTxHash', detail.txHashes.approveTxHash],
    ['fundTxHash', detail.txHashes.fundTxHash],
    ['submitTxHash', detail.txHashes.submitTxHash],
    ['completeTxHash', detail.txHashes.completeTxHash],
  ];
  for (const [name, val] of txFields) {
    if (!val) fail(`Missing ${name}`);
    ok(`${name}: ${(val as string).slice(0, 18)}...`);
  }
  ok('All 6 tx hashes present');

  // ── Verify payloads ───────────────────────────────────────────────────

  step('Verify payloads');
  ok(`inputPayloadHash: ${detail.payloads.inputPayloadHash?.slice(0, 18)}...`);
  ok(`deliverableHash: ${detail.payloads.deliverableHash?.slice(0, 18)}...`);
  ok(`reasonHash: ${detail.payloads.reasonHash?.slice(0, 18)}...`);

  // ── Verify timeline ───────────────────────────────────────────────────

  step('Verify timeline');
  ok(`Timeline events: ${detail.timeline.length}`);
  for (const ev of detail.timeline) {
    console.log(`    - ${ev.type} @ ${ev.createdAt}${ev.txHash ? ` tx:${ev.txHash.slice(0, 10)}...` : ''}`);
  }
  if (detail.timeline.length === 0) fail('Timeline is empty');

  // ── Verify allowed actions ────────────────────────────────────────────

  step('Verify allowed actions');
  ok(`Actions: [${detail.allowedActions.join(', ')}]`);
  // Terminal state should have no mutation actions (only reconcile if erc8183JobId exists)
  const mutationActions = detail.allowedActions.filter(
    (a) => a !== 'reconcile',
  );
  if (mutationActions.length > 0) {
    fail(`Terminal state should have no mutation actions, got: ${mutationActions}`);
  }
  ok('No mutation actions in terminal state');

  // ── Test normalizeErc8183LifecycleStatus ──────────────────────────────

  step('normalizeErc8183LifecycleStatus() unit check');
  // Simulate a Funded job
  const fundedStatus = normalizeErc8183LifecycleStatus(
    { ...detail, status: 'created', fundTxHash: '0xabc', completeTxHash: null, submitTxHash: null, erc8183JobId: '123' } as any,
    'Funded',
  );
  ok(`Funded job → ${fundedStatus}`);
  if (fundedStatus !== 'Funded') fail('Expected Funded');

  // Simulate a LocalCreated job
  const localStatus = normalizeErc8183LifecycleStatus(
    { ...detail, status: 'created', createTxHash: null, erc8183JobId: null } as any,
    null,
  );
  ok(`No tx → ${localStatus}`);
  if (localStatus !== 'LocalCreated') fail('Expected LocalCreated');

  // ── Test reconcileErc8183Job ──────────────────────────────────────────

  step('reconcileErc8183Job()');
  const reconcileResult = await reconcileErc8183Job(testJob.job_id);
  ok(`localJobId: ${reconcileResult.localJobId}`);
  ok(`erc8183JobId: ${reconcileResult.erc8183JobId}`);
  ok(`erc8183StatusChanged: ${reconcileResult.diff.erc8183StatusChanged}`);
  ok(`oldStatus: ${reconcileResult.diff.oldStatus}`);
  ok(`newStatus: ${reconcileResult.diff.newStatus}`);
  ok(`participantsMatch: ${reconcileResult.diff.participantsMatch}`);

  if (!reconcileResult.diff.participantsMatch) {
    fail('Participants mismatch after reconcile');
  }
  ok('Participants match on-chain');

  // ── Verify reconcile event was added ──────────────────────────────────

  step('Verify reconcile event in DB');
  const { data: events } = await sb
    .from('agent_job_events')
    .select('event_type, metadata')
    .eq('job_id', testJob.job_id)
    .eq('event_type', 'reconciled')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!events?.length) fail('No reconcile event found');
  ok(`Reconcile event: ${events[0].event_type}`);
  ok(`Metadata: participantsMatch=${(events[0].metadata as any)?.participantsMatch}`);

  // ── Done ──────────────────────────────────────────────────────────────

  console.log('\n=== ERC-8183 READ MODEL + RECONCILE TEST PASSED ===');
  console.log(`Job: ${testJob.job_id} (on-chain: ${testJob.erc8183_job_id})`);
  console.log(`Lifecycle: ${detail.lifecycleStatus}`);
  console.log(`Timeline: ${detail.timeline.length} events`);
  console.log(`Tx hashes: 6/6`);
  console.log(`Reconcile: participants match, event recorded`);
}

main().catch((err) => {
  console.error('\n=== TEST FAILED ===');
  console.error(err);
  process.exit(1);
});
