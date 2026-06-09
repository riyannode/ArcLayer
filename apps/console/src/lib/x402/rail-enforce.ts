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
export async function enforceRailHeader(
  req: Request,
  body?: Record<string, unknown> | null,
): Promise<NextResponse | null> {
  const headerRail = req.headers.get('x-arc-rail')?.trim().toLowerCase();
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

  // Extract wallet from query/header/body. If clients opt into rail enforcement,
  // require a wallet so the DB rail lock can actually be checked.
  const wallet = await extractWallet(req, body);
  if (!wallet) {
    return NextResponse.json(
      {
        ok: false,
        error: 'missing_wallet_for_rail_enforcement',
        message: 'X-ARC-RAIL was provided but no wallet could be resolved for rail enforcement.',
      },
      { status: 400 },
    );
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

async function extractWallet(req: Request, body?: Record<string, unknown> | null): Promise<string | null> {
  // Try query param first (GET requests).
  const url = new URL(req.url);
  const qWallet = normalizeWallet(url.searchParams.get('wallet'));
  if (qWallet) return qWallet;

  // Try X-ARC-WALLET header (set by RailProvider fetch wrapper).
  const hWallet = normalizeWallet(req.headers.get('x-arc-wallet'));
  if (hWallet) return hWallet;

  const parsedBody = body === undefined ? await readJsonBody(req) : body;
  if (!parsedBody) return null;

  return (
    normalizeWallet(parsedBody.wallet)
    ?? normalizeWallet(parsedBody.payer)
    ?? normalizeWallet(getPath(parsedBody, ['paymentPayload', 'payload', 'authorization', 'from']))
    ?? normalizeWallet(getPath(parsedBody, ['paymentPayload', 'payload', 'from']))
    ?? normalizeWallet(getPath(parsedBody, ['paymentRequirements', 'payer']))
  );
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return null;

  const body = await req.clone().json().catch(() => null);
  return isRecord(body) ? body : null;
}

function getPath(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function normalizeWallet(value: unknown): string | null {
  return typeof value === 'string' && /^0x[a-f0-9]{40}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
