/**
 * GET /api/erc8004/register/sync/health
 *
 * Preflight health check for Runner sync path.
 * Validates:
 * 1. Bearer token auth is configured and accepted
 * 2. Supabase admin client can be created
 * 3. erc8004_agents table is accessible (lightweight SELECT)
 *
 * Returns 200 { ok: true } only if all three pass.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // 1. Auth check (same pattern as sync endpoint)
  const expected = process.env.ARCLAYER_RUNNER_SYNC_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'sync_secret_not_configured' },
      { status: 500 },
    );
  }
  const auth = request.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
  const headerSecret = request.headers.get('x-arclayer-runner-sync-secret');
  if (bearer !== expected && headerSecret !== expected) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' },
      { status: 401 },
    );
  }

  // 2. Probe erc8004_agents table — lightweight count/read
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('erc8004_agents')
      .select('token_id', { count: 'exact', head: true })
      .limit(1);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: 'erc8004_agents_unreachable',
          detail: error.message,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: 'supabase_client_error',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}
