/**
 * GET /api/erc8183-jobs/[localJobId] — get ERC-8183 escrow job detail
 */
import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { getErc8183JobByLocalId } from '@/lib/erc8183-jobs/store';
import { escrowRail } from '@/lib/rails/responses';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ localJobId: string }> },
) {
  try {
    const auth = await requireApiKey(_req, [API_KEY_SCOPES.ERC8183_CREATE, API_KEY_SCOPES.ERC8183_TX]);
    if (auth.error) return auth.error;

    const { localJobId } = await params;
    const job = await getErc8183JobByLocalId(localJobId);

    if (!job) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'not_found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      ...escrowRail(),
      job,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'get_failed', message },
      { status: 500 },
    );
  }
}
