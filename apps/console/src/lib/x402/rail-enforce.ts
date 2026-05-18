import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export type Rail = 'native' | 'gateway';

/**
 * Enforce X-ARC-RAIL header consistency.
 *
 * Returns null if valid (or no enforcement needed), or a NextResponse 400/409 if mismatch.
 *
 * Usage in any API route:
 *   const railErr = await enforceRailHeader(req);
 *   if (railErr) return railErr;
 */
export async function enforceRailHeader(req: Request): Promise<NextResponse | null> {
  const headerRail = req.headers.get('x-arc-rail')?.toLowerCase();
  if (!headerRail) {
    // No header = no enforcement (backwards compat for non-rail-aware clients).
    return null;
  }

  if (headerRail !== 'native' && headerRail !== 'gateway') {
    return NextResponse.json(
      { ok: false, error: 'invalid_rail_header', message: "X-ARC-RAIL must be 'native' or 'gateway'." },
      { status: 400 },
    );
  }

  // Extract wallet from body or query (best-effort — some routes pass it differently).
  const wallet = extractWallet(req);
  if (!wallet) {
    // Can't verify against DB without wallet — allow through (header is syntactically valid).
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('user_rail_preferences')
    .select('rail')
    .eq('wallet_address', wallet.toLowerCase())
    .maybeSingle();

  if (data && data.rail !== headerRail) {
    return NextResponse.json(
      {
        ok: false,
        error: 'rail_mismatch',
        message: `Wallet is locked to '${data.rail}' but request sent '${headerRail}'.`,
        lockedRail: data.rail,
      },
      { status: 409 },
    );
  }

  return null;
}

/**
 * Lock a rail for a specific job. Returns error response if job already has a different rail.
 */
export async function lockJobRail(jobId: string, wallet: string, rail: Rail): Promise<NextResponse | null> {
  const supabase = getSupabaseAdmin();

  const { data: existing } = await supabase
    .from('job_rail_locks')
    .select('rail')
    .eq('job_id', jobId)
    .maybeSingle();

  if (existing) {
    if (existing.rail !== rail) {
      return NextResponse.json(
        {
          ok: false,
          error: 'job_rail_immutable',
          message: `Job '${jobId}' is locked to '${existing.rail}'. Cannot switch to '${rail}'.`,
          lockedRail: existing.rail,
        },
        { status: 409 },
      );
    }
    return null; // Already locked to same rail — OK.
  }

  const { error } = await supabase
    .from('job_rail_locks')
    .insert({ job_id: jobId, wallet_address: wallet.toLowerCase(), rail });

  if (error) {
    // Race condition: another request inserted first — re-read.
    const { data: raceCheck } = await supabase
      .from('job_rail_locks')
      .select('rail')
      .eq('job_id', jobId)
      .maybeSingle();

    if (raceCheck && raceCheck.rail !== rail) {
      return NextResponse.json(
        {
          ok: false,
          error: 'job_rail_immutable',
          message: `Job '${jobId}' was locked to '${raceCheck.rail}' by a concurrent request.`,
          lockedRail: raceCheck.rail,
        },
        { status: 409 },
      );
    }
  }

  return null;
}

/**
 * Read the rail for a job. Returns null if not yet locked.
 */
export async function getJobRail(jobId: string): Promise<Rail | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('job_rail_locks')
    .select('rail')
    .eq('job_id', jobId)
    .maybeSingle();
  return (data?.rail as Rail) ?? null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function extractWallet(req: Request): string | null {
  // Try query param first (GET requests).
  const url = new URL(req.url);
  const qWallet = url.searchParams.get('wallet');
  if (qWallet && /^0x[a-f0-9]{40}$/i.test(qWallet)) return qWallet.toLowerCase();

  // Try X-ARC-WALLET header (set by RailProvider fetch wrapper).
  const hWallet = req.headers.get('x-arc-wallet');
  if (hWallet && /^0x[a-f0-9]{40}$/i.test(hWallet)) return hWallet.toLowerCase();

  return null;
}
