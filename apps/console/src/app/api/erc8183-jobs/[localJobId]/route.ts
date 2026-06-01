/**
 * GET /api/erc8183-jobs/[localJobId] — get ERC-8183 escrow job detail
 *
 * Returns full job detail with normalized lifecycle status,
 * timeline, proof/result hashes, tx hashes, and allowed actions.
 */
import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { buildErc8183JobDetail } from '@/lib/erc8183-jobs/read-model';
import { escrowRail } from '@/lib/rails/responses';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ localJobId: string }> },
) {
  try {
    const auth = await requireApiKey(_req, [API_KEY_SCOPES.ERC8183_CREATE, API_KEY_SCOPES.ERC8183_TX]);
    if (auth.error) return auth.error;

    const { localJobId } = await params;
    const detail = await buildErc8183JobDetail(localJobId);

    if (!detail) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'not_found' },
        { status: 404, headers: { 'Cache-Control': 'no-store, no-cache, max-age=0' } },
      );
    }

    return NextResponse.json(
      { ok: true, ...escrowRail(), job: detail },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'get_failed', message },
      { status: 500, headers: { 'Cache-Control': 'no-store, no-cache, max-age=0' } },
    );
  }
}
