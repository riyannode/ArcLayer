/**
 * Trade history store for the A2A demo pipeline.
 *
 * Production storage rule:
 *   - Supabase is primary when SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and
 *     SUPABASE_SERVICE_ROLE_KEY exist.
 *   - JSONL is local/VPS fallback when Supabase env is missing or unavailable.
 *
 * Why this matters:
 *   - Vercel frontend/API cannot read a VPS-local JSONL file.
 *   - The autonomous runner may run on a VPS while `/api/a2a/history` runs on
 *     Vercel. Supabase is the shared production history store.
 */
// NOTE: No 'server-only' — this module is shared between Next.js API routes
// and standalone tsx scripts (agent-market-runner, update-trade-pnl).
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type Asset = 'BTC' | 'ETH';
export type Direction = 'UP' | 'DOWN' | 'NEUTRAL';
export type HermesAction = 'BUY_UP' | 'BUY_DOWN' | 'SKIP';
export type StorageMode = 'supabase' | 'jsonl';
export type RunStatus =
  | 'PENDING'
  | 'NO_CHANGE_SKIPPED'
  | 'WIN'
  | 'LOSS'
  | 'PUSH'
  | 'ERROR';

export interface TradeRecord {
  id: string;
  recordedAt: string;
  windowStart: number;
  windowEnd: number;
  asset: Asset;
  marketSlug: string;
  snapshotHash: string;
  pythia: {
    rawSignal: Direction;
    confidence: number;
    features: string[];
    reasoning?: string;
  };
  apolo: {
    decision: Direction;
    status: 'APPROVED' | 'REJECTED';
    confidence: number;
    risk: 'LOW' | 'MEDIUM' | 'HIGH';
    reason: string;
    reasoning?: string;
  };
  hermes: {
    action: HermesAction;
    sizeUsdc: string;
    mode: 'DRY_RUN' | 'LIVE';
    receipts: { service: string; amountUsdc: string; receiptId: string; settlementTxHash: string }[];
  };
  snapshot: {
    upPrice: number;
    downPrice: number;
    spread: number;
    volume: number | null;
  };
  reasoningMode: 'deterministic' | 'llm';
  status: RunStatus;
  resolution?: {
    resolvedAt: string;
    finalUpPrice: number;
    finalDownPrice: number;
    pnlUsdc: number;
    pnlBps: number;
    note: string;
  };
  skippedFromId?: string;
  error?: string;
}

const DEFAULT_PATH = process.env.A2A_TRADES_PATH || path.join(process.cwd(), 'data', 'a2a-trades.jsonl');

function tradesFile(): string {
  return DEFAULT_PATH;
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

export function getConfiguredStorageMode(): StorageMode {
  return supabaseConfig() ? 'supabase' : 'jsonl';
}

export function hashSnapshot(input: { asset: Asset; windowStart: number; upPrice: number; downPrice: number; volume: number | null }): string {
  const canonical = JSON.stringify({
    asset: input.asset,
    windowStart: input.windowStart,
    up: Number(input.upPrice.toFixed(4)),
    down: Number(input.downPrice.toFixed(4)),
    vol: input.volume == null ? null : Math.round(input.volume),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

function toSupabaseRow(record: TradeRecord) {
  return {
    id: record.id,
    recorded_at: record.recordedAt,
    window_start: record.windowStart,
    window_end: record.windowEnd,
    asset: record.asset,
    status: record.status,
    market_slug: record.marketSlug,
    snapshot_hash: record.snapshotHash,
    record,
    updated_at: new Date().toISOString(),
  };
}

async function upsertSupabaseTrade(record: TradeRecord): Promise<void> {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error('supabase_not_configured');
  const endpoint = `${cfg.url}/rest/v1/a2a_trades?on_conflict=id`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(toSupabaseRow(record)),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`supabase_upsert_${resp.status}${body ? `:${body.slice(0, 180)}` : ''}`);
  }
}

async function readSupabaseTrades(): Promise<TradeRecord[]> {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error('supabase_not_configured');
  const endpoint = `${cfg.url}/rest/v1/a2a_trades?select=record&order=window_start.desc,recorded_at.desc&limit=1000`;
  const resp = await fetch(endpoint, {
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
    },
    cache: 'no-store',
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`supabase_read_${resp.status}${body ? `:${body.slice(0, 180)}` : ''}`);
  }
  const rows = (await resp.json()) as Array<{ record: TradeRecord }>;
  return rows.map((r) => r.record).filter(Boolean);
}

async function appendJsonlTrade(record: TradeRecord): Promise<void> {
  const file = tradesFile();
  await ensureDir(file);
  await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf8');
}

async function readJsonlTrades(): Promise<TradeRecord[]> {
  const file = tradesFile();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const out: TradeRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as TradeRecord);
    } catch {
      // skip malformed line — likely a partial write from a crashed process
    }
  }
  return out;
}

async function rewriteJsonlTrades(records: TradeRecord[]): Promise<void> {
  const file = tradesFile();
  await ensureDir(file);
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  await fs.rename(tmp, file);
}

export interface TradeReadResult {
  storage: StorageMode;
  trades: TradeRecord[];
  fallbackReason?: string;
}

/**
 * Append one trade. Supabase is primary when configured; JSONL is fallback.
 * Returns the storage mode that actually accepted the write.
 */
export async function appendTrade(record: TradeRecord): Promise<StorageMode> {
  if (supabaseConfig()) {
    try {
      await upsertSupabaseTrade(record);
      return 'supabase';
    } catch (err: any) {
      console.warn('[trade-store] supabase write failed, falling back to jsonl:', err?.message);
    }
  }
  await appendJsonlTrade(record);
  return 'jsonl';
}

/**
 * Read trades. Supabase is attempted first when configured; JSONL fallback keeps
 * local/dev and degraded production demos working.
 */
export async function readTradesWithStorage(): Promise<TradeReadResult> {
  if (supabaseConfig()) {
    try {
      return { storage: 'supabase', trades: await readSupabaseTrades() };
    } catch (err: any) {
      return { storage: 'jsonl', trades: await readJsonlTrades(), fallbackReason: err?.message || 'supabase_read_failed' };
    }
  }
  return { storage: 'jsonl', trades: await readJsonlTrades() };
}

export async function readAllTrades(): Promise<TradeRecord[]> {
  return (await readTradesWithStorage()).trades;
}

export async function findLatestRunForWindow(asset: Asset, windowStart: number): Promise<TradeRecord | null> {
  const all = await readAllTrades();
  for (let i = all.length - 1; i >= 0; i--) {
    const r = all[i];
    if (r.asset === asset && r.windowStart === windowStart) return r;
  }
  return null;
}

export async function findLatestRunForAsset(asset: Asset): Promise<TradeRecord | null> {
  const all = await readAllTrades();
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].asset === asset) return all[i];
  }
  return null;
}

/**
 * Update a record by id. Supabase-primary when configured; JSONL fallback.
 */
export async function updateTrade(id: string, mutate: (r: TradeRecord) => TradeRecord): Promise<TradeRecord | null> {
  const { trades, storage } = await readTradesWithStorage();
  const idx = trades.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const next = mutate(trades[idx]);

  if (storage === 'supabase' && supabaseConfig()) {
    try {
      await upsertSupabaseTrade(next);
      return next;
    } catch (err: any) {
      console.warn('[trade-store] supabase update failed, falling back to jsonl:', err?.message);
    }
  }

  trades[idx] = next;
  await rewriteJsonlTrades(trades);
  return next;
}

export interface TradeStats {
  total: number;
  pending: number;
  skipped: number;
  wins: number;
  losses: number;
  pushes: number;
  errors: number;
  hitRate: number;
  totalPnlUsdc: number;
  totalPnlBps: number;
  byAsset: Record<Asset, { wins: number; losses: number; pnlUsdc: number }>;
}

export function summarize(records: TradeRecord[]): TradeStats {
  const stats: TradeStats = {
    total: records.length,
    pending: 0,
    skipped: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    errors: 0,
    hitRate: 0,
    totalPnlUsdc: 0,
    totalPnlBps: 0,
    byAsset: { BTC: { wins: 0, losses: 0, pnlUsdc: 0 }, ETH: { wins: 0, losses: 0, pnlUsdc: 0 } },
  };

  for (const r of records) {
    switch (r.status) {
      case 'PENDING': stats.pending++; break;
      case 'NO_CHANGE_SKIPPED': stats.skipped++; break;
      case 'WIN': stats.wins++; break;
      case 'LOSS': stats.losses++; break;
      case 'PUSH': stats.pushes++; break;
      case 'ERROR': stats.errors++; break;
    }
    if (r.resolution) {
      stats.totalPnlUsdc += r.resolution.pnlUsdc;
      stats.totalPnlBps += r.resolution.pnlBps;
    }
    if (r.status === 'WIN' || r.status === 'LOSS') {
      const bucket = stats.byAsset[r.asset];
      if (bucket) {
        if (r.status === 'WIN') bucket.wins++;
        else bucket.losses++;
        if (r.resolution) bucket.pnlUsdc += r.resolution.pnlUsdc;
      }
    }
  }
  const decided = stats.wins + stats.losses;
  stats.hitRate = decided > 0 ? stats.wins / decided : 0;
  return stats;
}
