/**
 * GET /api/a2a/history
 *
 * Returns trade history with optional filters.
 * Query params:
 *   - asset: BTC | ETH (filter by asset)
 *   - status: PENDING | WIN | LOSS | PUSH | ERROR | NO_CHANGE_SKIPPED
 *   - limit: number (default 50, max 200)
 *   - offset: number (default 0)
 *   - stats: "true" to include aggregate stats in response
 */
import { NextResponse } from 'next/server';
import { readTradesWithStorage, summarize, type Asset, type RunStatus } from '@/lib/a2a/trade-store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const assetFilter = url.searchParams.get('asset')?.toUpperCase() as Asset | null;
    const statusFilter = url.searchParams.get('status')?.toUpperCase() as RunStatus | null;
    const includeStats = url.searchParams.get('stats') === 'true';
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    const { storage, trades: allTrades, fallbackReason } = await readTradesWithStorage();

    let records = allTrades;

    // Apply filters
    if (assetFilter && (assetFilter === 'BTC' || assetFilter === 'ETH')) {
      records = records.filter((r) => r.asset === assetFilter);
    }
    if (statusFilter) {
      records = records.filter((r) => r.status === statusFilter);
    }

    // Sort newest first
    records.sort((a, b) => b.windowStart - a.windowStart);

    const total = records.length;
    const page = records.slice(offset, offset + limit);

    const response: Record<string, unknown> = {
      ok: true,
      storage,
      ...(fallbackReason ? { fallbackReason } : {}),
      total,
      offset,
      limit,
      count: page.length,
      trades: page,
    };

    if (includeStats) {
      response.stats = summarize(records);
    }

    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'history_read_failed', trades: [] },
      { status: 500 },
    );
  }
}
