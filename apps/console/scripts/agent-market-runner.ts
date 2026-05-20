#!/usr/bin/env node
/**
 * ArcLayer A2A 15-minute autonomous Polymarket runner.
 *
 * Flow:
 *   Live Polymarket 15m snapshot
 *     → Pythia signal
 *     → Apolo risk decision
 *     → Hermes DRY_RUN execution intent
 *     → x402 receipt chain
 *     → persist to Supabase primary or JSONL fallback
 *
 * Defaults are deliberately safe:
 *   - 15-minute interval (not 5m)
 *   - deterministic reasoning unless A2A_REASONING_MODE=llm
 *   - no real Polymarket orders
 *   - no real on-chain execution
 *   - snapshot hash unchanged → NO_CHANGE_SKIPPED and no LLM call
 *
 * Usage:
 *   pnpm --dir apps/console a2a:runner:once
 *   pnpm --dir apps/console a2a:runner
 */
import { createHash } from 'node:crypto';
import {
  appendTrade,
  findLatestRunForAsset,
  getConfiguredStorageMode,
  hashSnapshot,
  type TradeRecord,
} from '../src/lib/a2a/trade-store';
import {
  deriveSignal,
  deriveSignalDeterministic,
  fetchMarket15m,
  type Asset,
  type ReasoningMode,
} from '../src/lib/a2a/signal-engine';
import {
  makeApoloDecisionCharge,
  makeHermesIntentCharge,
  makePythiaSignalCharge,
} from '../src/lib/a2a/x402-flow';

const ASSETS: Asset[] = (process.env.A2A_MARKET_ASSETS || 'BTC,ETH')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter((s): s is Asset => s === 'BTC' || s === 'ETH');

const INTERVAL_MS = Number(process.env.A2A_RUNNER_INTERVAL_MS || 15 * 60 * 1000);
const ONCE = process.argv.includes('--once') || process.env.A2A_RUNNER_ONCE === 'true';
const REASONING_MODE: ReasoningMode = process.env.A2A_REASONING_MODE === 'llm' ? 'llm' : 'deterministic';

function idFor(args: { asset: Asset; slug: string; snapshotHash: string; status?: string }): string {
  return createHash('sha256')
    .update(`${args.asset}:${args.slug}:${args.snapshotHash}:${args.status || 'run'}`)
    .digest('hex')
    .slice(0, 32);
}

function receipts() {
  return [makePythiaSignalCharge(), makeApoloDecisionCharge(), makeHermesIntentCharge()].map((c) => ({
    service: c.service,
    amountUsdc: c.amountUsdc,
    receiptId: c.receiptId,
    settlementTxHash: c.settlementTxHash,
  }));
}

async function recordNoChange(asset: Asset, prev: TradeRecord, snapshotHash: string): Promise<void> {
  const now = new Date().toISOString();
  const record: TradeRecord = {
    id: idFor({ asset, slug: prev.marketSlug, snapshotHash, status: `skip:${Date.now()}` }),
    recordedAt: now,
    windowStart: prev.windowStart,
    windowEnd: prev.windowEnd,
    asset,
    marketSlug: prev.marketSlug,
    snapshotHash,
    pythia: prev.pythia,
    apolo: prev.apolo,
    hermes: { ...prev.hermes, receipts: [] },
    snapshot: prev.snapshot,
    reasoningMode: prev.reasoningMode,
    status: 'NO_CHANGE_SKIPPED',
    skippedFromId: prev.id,
  };
  const savedTo = await appendTrade(record);
  console.log(`[${now}] ${asset} NO_CHANGE_SKIPPED hash=${snapshotHash} prev=${prev.id.slice(0, 10)} saved_to=${savedTo}`);
}

async function runAsset(asset: Asset): Promise<void> {
  const market = await fetchMarket15m(asset);
  if (!market) {
    const now = new Date().toISOString();
    const baseline = deriveSignalDeterministic({
      slug: `${asset.toLowerCase()}-updown-15m-unavailable`,
      question: `${asset} 15m unavailable`,
      asset,
      upPrice: 0.5,
      downPrice: 0.5,
      spread: 0,
      volume: null,
      windowStart: Math.floor(Date.now() / 1000),
      windowEnd: Math.floor(Date.now() / 1000) + 900,
    });
    const record: TradeRecord = {
      id: idFor({ asset, slug: baseline.market.slug, snapshotHash: 'unavailable', status: `error:${Date.now()}` }),
      recordedAt: now,
      windowStart: baseline.market.windowStart,
      windowEnd: baseline.market.windowEnd,
      asset,
      marketSlug: baseline.market.slug,
      snapshotHash: 'unavailable',
      pythia: baseline.pythia,
      apolo: baseline.apolo,
      hermes: { ...baseline.hermes, receipts: [] },
      snapshot: {
        upPrice: 0.5,
        downPrice: 0.5,
        spread: 0,
        volume: null,
      },
      reasoningMode: 'deterministic',
      status: 'ERROR',
      error: 'polymarket_15m_market_unavailable',
    };
    const savedTo = await appendTrade(record);
    console.log(`[${now}] ${asset} ERROR polymarket_15m_market_unavailable saved_to=${savedTo}`);
    return;
  }

  const snapshotHash = hashSnapshot({
    asset,
    windowStart: market.windowStart,
    upPrice: market.upPrice,
    downPrice: market.downPrice,
    volume: market.volume,
  });

  const prev = await findLatestRunForAsset(asset);
  if (prev && prev.snapshotHash === snapshotHash) {
    await recordNoChange(asset, prev, snapshotHash);
    return;
  }

  // Only now call LLM (if enabled). Unchanged snapshots never spend LLM budget.
  const derived = await deriveSignal(market, REASONING_MODE);
  const now = new Date().toISOString();

  const record: TradeRecord = {
    id: idFor({ asset, slug: market.slug, snapshotHash }),
    recordedAt: now,
    windowStart: market.windowStart,
    windowEnd: market.windowEnd,
    asset,
    marketSlug: market.slug,
    snapshotHash,
    pythia: derived.pythia,
    apolo: derived.apolo,
    hermes: { ...derived.hermes, mode: 'DRY_RUN', receipts: receipts() },
    snapshot: {
      upPrice: market.upPrice,
      downPrice: market.downPrice,
      spread: market.spread,
      volume: market.volume,
    },
    reasoningMode: derived.reasoningMode,
    status: 'PENDING',
  };

  const savedTo = await appendTrade(record);
  console.log(
    `[${now}] ${asset} ${record.apolo.status} ${record.apolo.decision} conf=${record.apolo.confidence} action=${record.hermes.action} mode=${record.reasoningMode} hash=${snapshotHash} saved_to=${savedTo}`,
  );
}

async function runOnce(): Promise<void> {
  const storageMode = getConfiguredStorageMode();
  console.log(`[${new Date().toISOString()}] A2A 15m runner tick assets=${ASSETS.join(',')} mode=${REASONING_MODE} storage=${storageMode}`);
  for (const asset of ASSETS) {
    try {
      await runAsset(asset);
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}] ${asset} runner_error: ${err?.message || err}`);
    }
  }
}

async function main() {
  await runOnce();
  if (ONCE) return;
  console.log(`[${new Date().toISOString()}] next tick every ${Math.round(INTERVAL_MS / 1000)}s`);
  setInterval(() => {
    runOnce().catch((err) => console.error(`[runner] tick_error: ${err?.message || err}`));
  }, INTERVAL_MS);
}

main().catch((err) => {
  console.error(`[runner] fatal: ${err?.stack || err?.message || err}`);
  process.exit(1);
});
