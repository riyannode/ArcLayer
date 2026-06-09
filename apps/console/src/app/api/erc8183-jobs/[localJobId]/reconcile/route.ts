import { humanJson } from '@/lib/api/human-json';
/**
 * POST /api/erc8183-jobs/[localJobId]/reconcile
 *
 * Compare local mirror against on-chain ERC-8183 getJob.
 * Updates only derived fields (erc8183Status, budget if empty).
 * Does NOT overwrite tx hashes.
 */

import { NextRequest } from 'next/server';
import { requireApiKey, API_KEY_SCOPES } from '@/lib/a2a/auth';
import { reconcileErc8183Job } from '@/lib/erc8183-jobs/reconcile';
import { escrowRail } from '@/lib/rails/responses';

export const dynamic = 'force-dynamic';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ localJobId: string }> },
) {
  try {
    const auth = await requireApiKey(req, [
      API_KEY_SCOPES.ERC8183_TX,
      API_KEY_SCOPES.ERC8183_CREATE,
    ]);
    if (auth.error) return auth.error;

    const { localJobId } = await params;
    const result = await reconcileErc8183Job(localJobId);

    return humanJson(req, result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';

    const status =
      message === 'local_job_not_found' ? 404 :
      message.startsWith('erc8183_job_id_missing') ? 400 :
      message === 'onchain_job_not_found' ? 422 :
      message.startsWith('participant_mismatch') ? 422 :
      message.startsWith('reconcile_update_failed') ? 502 :
      500;

    return humanJson(req, { ok: false, ...escrowRail(), error: 'reconcile_failed', detail: message }, { status, headers: { 'Cache-Control': ERROR_CACHE } });
  }
}
