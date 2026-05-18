import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export const runtime = 'nodejs';

type Rail = 'native' | 'gateway';

function isRail(value: unknown): value is Rail {
  return value === 'native' || value === 'gateway';
}

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(trimmed)) return null;
  return trimmed;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const wallet = normalizeAddress(searchParams.get('wallet'));
  if (!wallet) {
    return NextResponse.json(
      { ok: false, error: 'invalid_wallet', message: 'wallet query is required.' },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('user_rail_preferences')
    .select('rail, created_at, updated_at')
    .eq('wallet_address', wallet)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'db_error', message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    wallet,
    rail: data?.rail ?? null,
    createdAt: data?.created_at ?? null,
    updatedAt: data?.updated_at ?? null,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { ok: false, error: 'invalid_json', message: 'Body must be JSON.' },
      { status: 400 },
    );
  }

  const wallet = normalizeAddress((body as { wallet?: unknown }).wallet);
  const rail = (body as { rail?: unknown }).rail;
  if (!wallet) {
    return NextResponse.json(
      { ok: false, error: 'invalid_wallet', message: 'wallet must be a 0x-prefixed 20-byte address.' },
      { status: 400 },
    );
  }
  if (!isRail(rail)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_rail', message: "rail must be 'native' or 'gateway'." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: existing, error: readError } = await supabase
    .from('user_rail_preferences')
    .select('rail, created_at, updated_at')
    .eq('wallet_address', wallet)
    .maybeSingle();

  if (readError) {
    return NextResponse.json(
      { ok: false, error: 'db_error', message: readError.message },
      { status: 500 },
    );
  }

  if (existing) {
    if (existing.rail !== rail) {
      return NextResponse.json(
        { ok: false, error: 'rail_locked', message: 'Rail is already locked for this wallet session.', rail: existing.rail },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      wallet,
      rail: existing.rail,
      createdAt: existing.created_at,
      updatedAt: existing.updated_at,
    });
  }

  const { data, error } = await supabase
    .from('user_rail_preferences')
    .insert({ wallet_address: wallet, rail })
    .select('rail, created_at, updated_at')
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'db_error', message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    wallet,
    rail: data.rail,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  });
}
