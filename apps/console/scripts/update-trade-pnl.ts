#!/usr/bin/env node
/**
 * ArcLayer A2A PnL Resolver.
 *
 * Scans data/a2a-trades.jsonl for PENDING records whose 15m window has closed,
 * fetches the resolved market outcome from Polymarket, and marks them WIN/LOSS/PUSH.
 *
 * Logic:
 *   - A 15m window is "closed" when now > windowEnd + GRACE_SEC (default 120s).
 *   - Fetch the resolved market from gamma-api. If the market is still active,
 *     skip (it hasn't resolved yet).
 *   - Compare Hermes' action (BUY_UP / BUY_DOWN) against the resolved outcome.
 *   - Compute notional PnL: if Hermes bought UP at upPrice and it resolved to 1.0,
 *     profit = (1.0 - upPrice) * sizeUsdc. If it resolved to 0.0, loss = -upPrice * sizeUsdc.
 *   - SKIP actions get PUSH (no position, no PnL).
 *
 * Usage:
 *   pnpm --dir apps/console a2a:pnl:once
 *   pnpm --dir apps/console a2a:pnl
 */
import {
  readAllTrades,
  updateTrade,
  type TradeRecord,
} from '../src/lib/a2a/trade-store';

const GRACE_SEC = Number(process.env.A2A_PNL_GRACE_SEC || 120);
const INTERVAL_MS = Number(process.env.A2A_PNL_INTERVAL_MS || 5 * 60 * 1000); // check every 5m
const ONCE = process.argv.includes('--once') || process.env.A2A_PNL_ONCE === 'true';

interface ResolvedOutcome {
  upResolved: number; // 1.0 if UP won, 0.0 if DOWN won, 0.5 if unresolved
  downResolved: number;
  resolved: boolean;
}

async function fetchResolution(slug: string): Promise<ResolvedOutcome | null> {
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const markets = await res.json();
    if (!Array.isArray(markets) || markets.length === 0) return null;
    const m = markets[0];

    // Polymarket marks resolved markets with `active: false` and final outcomePrices.
    if (m.active === true) return null; // not yet resolved

    let prices: [number, number] = [0.5, 0.5];
    try {
      const arr = JSON.parse(m.outcomePrices || '["0.5","0.5"]');
      prices = [Number(arr[0]) || 0.5, Number(arr[1]) || 0.5];
    } catch {}

    // Resolved markets snap to 1.0/0.0 (or very close).
    const resolved = prices[0] >= 0.95 || prices[0] <= 0.05;
    return {
      upResolved: prices[0],
      downResolved: prices[1],
      resolved,
    };
  } catch {
    return null;
  }
}

function computePnl(
  record: TradeRecord,
  outcome: ResolvedOutcome,
): { status: 'WIN' | 'LOSS' | 'PUSH'; pnlUsdc: number; pnlBps: number; note: string } {
  const { action, sizeUsdc } = record.hermes;
  const size = Number(sizeUsdc) || 0;

  // SKIP → no position → PUSH with 0 PnL.
  if (action === 'SKIP' || size === 0) {
    return { status: 'PUSH', pnlUsdc: 0, pnlBps: 0, note: 'No position (SKIP)' };
  }

  // If market didn't fully resolve (still ~0.5/0.5), mark PUSH.
  if (!outcome.resolved) {
    return { status: 'PUSH', pnlUsdc: 0, pnlBps: 0, note: 'Market did not fully resolve' };
  }

  const upWon = outcome.upResolved >= 0.95;

  if (action === 'BUY_UP') {
    if (upWon) {
      // Bought UP at upPrice, resolved to 1.0 → profit = (1 - entryPrice) * size
      const profit = (1.0 - record.snapshot.upPrice) * size;
      const bps = Math.round((profit / size) * 10000);
      return { status: 'WIN', pnlUsdc: Number(profit.toFixed(6)), pnlBps: bps, note: `UP won. Entry ${record.snapshot.upPrice.toFixed(3)} → 1.000` };
    } else {
      // UP lost → position worth 0
      const loss = -record.snapshot.upPrice * size;
      const bps = Math.round((loss / size) * 10000);
      return { status: 'LOSS', pnlUsdc: Number(loss.toFixed(6)), pnlBps: bps, note: `UP lost. Entry ${record.snapshot.upPrice.toFixed(3)} → 0.000` };
    }
  }

  if (action === 'BUY_DOWN') {
    if (!upWon) {
      // Bought DOWN at downPrice, resolved to 1.0 → profit = (1 - entryPrice) * size
      const profit = (1.0 - record.snapshot.downPrice) * size;
      const bps = Math.round((profit / size) * 10000);
      return { status: 'WIN', pnlUsdc: Number(profit.toFixed(6)), pnlBps: bps, note: `DOWN won. Entry ${record.snapshot.downPrice.toFixed(3)} → 1.000` };
    } else {
      // DOWN lost → position worth 0
      const loss = -record.snapshot.downPrice * size;
      const bps = Math.round((loss / size) * 10000);
      return { status: 'LOSS', pnlUsdc: Number(loss.toFixed(6)), pnlBps: bps, note: `DOWN lost. Entry ${record.snapshot.downPrice.toFixed(3)} → 0.000` };
    }
  }

  return { status: 'PUSH', pnlUsdc: 0, pnlBps: 0, note: 'Unknown action' };
}

async function resolveOnce(): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const all = await readAllTrades();
  const pending = all.filter(
    (r) => r.status === 'PENDING' && r.windowEnd + GRACE_SEC < nowSec,
  );

  if (pending.length === 0) {
    console.log(`[${new Date().toISOString()}] pnl: no pending trades to resolve`);
    return;
  }

  console.log(`[${new Date().toISOString()}] pnl: resolving ${pending.length} pending trades`);

  for (const record of pending) {
    const outcome = await fetchResolution(record.marketSlug);
    if (!outcome) {
      // Market not yet resolved or fetch failed — skip for now, retry next tick.
      console.log(`  ${record.id.slice(0, 10)} ${record.asset} slug=${record.marketSlug} → not yet resolved`);
      continue;
    }

    const { status, pnlUsdc, pnlBps, note } = computePnl(record, outcome);

    await updateTrade(record.id, (r) => ({
      ...r,
      status,
      resolution: {
        resolvedAt: new Date().toISOString(),
        finalUpPrice: outcome.upResolved,
        finalDownPrice: outcome.downResolved,
        pnlUsdc,
        pnlBps,
        note,
      },
    }));

    console.log(
      `  ${record.id.slice(0, 10)} ${record.asset} ${record.hermes.action} → ${status} pnl=${pnlUsdc.toFixed(4)} USDC (${pnlBps}bps) — ${note}`,
    );
  }
}

async function main() {
  await resolveOnce();
  if (ONCE) return;
  console.log(`[${new Date().toISOString()}] pnl resolver running every ${Math.round(INTERVAL_MS / 1000)}s`);
  setInterval(() => {
    resolveOnce().catch((err) => console.error(`[pnl] tick_error: ${err?.message || err}`));
  }, INTERVAL_MS);
}

main().catch((err) => {
  console.error(`[pnl] fatal: ${err?.stack || err?.message || err}`);
  process.exit(1);
});
