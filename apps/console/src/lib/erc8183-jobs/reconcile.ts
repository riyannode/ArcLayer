/**
 * ERC-8183 Reconcile Helper
 *
 * Compares local mirror against on-chain ERC-8183 getJob.
 * Updates only derived fields (erc8183Status, budget if empty).
 * Does NOT overwrite tx hashes.
 */

import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { readOnchainJob, ONCHAIN_STATUS_MAP } from './receipt';
import type { Erc8183Status } from './types';

export interface ReconcileResult {
  ok: true;
  localJobId: string;
  erc8183JobId: string;
  diff: {
    erc8183StatusChanged: boolean;
    oldStatus: Erc8183Status | null;
    newStatus: Erc8183Status;
    budgetUpdated: boolean;
    participantsMatch: boolean;
  };
}

/**
 * Reconcile local mirror against on-chain state.
 * No tx signing. Only updates derived fields.
 */
export async function reconcileErc8183Job(
  localJobId: string,
): Promise<ReconcileResult> {
  const db = getSupabaseAdmin();

  // 1. Read local job
  const { data: localJob, error: readErr } = await db
    .from('agent_jobs')
    .select('*')
    .eq('job_id', localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .single();

  if (readErr || !localJob) {
    throw new Error('local_job_not_found');
  }

  const erc8183JobId = localJob.erc8183_job_id;
  if (!erc8183JobId) {
    throw new Error('erc8183_job_id_missing — confirm create tx first');
  }

  // 2. Read on-chain state
  const onchain = await readOnchainJob(BigInt(erc8183JobId));
  if (!onchain) {
    throw new Error('onchain_job_not_found');
  }

  const onchainStatus = onchain.erc8183Status;
  const oldStatus = localJob.erc8183_status as Erc8183Status | null;

  // 3. Validate participants match
  const participantsMatch =
    localJob.client_address?.toLowerCase() === onchain.client.toLowerCase() &&
    localJob.provider_address?.toLowerCase() === onchain.provider.toLowerCase() &&
    (localJob.evaluator_address?.toLowerCase() === onchain.evaluator.toLowerCase() ||
      onchain.evaluator === '0x0000000000000000000000000000000000000000');

  if (!participantsMatch) {
    throw new Error('participant_mismatch — local and on-chain participants differ');
  }

  // 4. Update derived fields
  const updates: Record<string, unknown> = {};

  if (oldStatus !== onchainStatus) {
    updates.erc8183_status = onchainStatus;
  }

  // Update budget if empty and on-chain has it
  if (!localJob.price_atomic && onchain.budget > 0n) {
    updates.price_atomic = onchain.budget.toString();
  }

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();

    const { error: updateErr } = await db
      .from('agent_jobs')
      .update(updates)
      .eq('job_id', localJobId)
      .eq('settlement_mode', 'erc8183_escrow');

    if (updateErr) {
      throw new Error(`reconcile_update_failed: ${updateErr.message}`);
    }
  }

  // 5. Add reconcile event
  await db.from('agent_job_events').insert({
    job_id: localJobId,
    event_type: 'reconciled',
    actor_agent_id: 'system',
    status_before: oldStatus,
    status_after: onchainStatus,
    payload_hash: null,
    metadata: {
      onchainStatus,
      localStatus: localJob.status,
      participantsMatch,
      fieldsUpdated: Object.keys(updates),
    },
  });

  return {
    ok: true,
    localJobId,
    erc8183JobId,
    diff: {
      erc8183StatusChanged: oldStatus !== onchainStatus,
      oldStatus,
      newStatus: onchainStatus,
      budgetUpdated: !!updates.price_atomic,
      participantsMatch,
    },
  };
}
