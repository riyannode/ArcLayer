import type { Asset, Candle1m } from './types';

export async function fetchBinanceCandles1m(asset: Asset, limit = 60): Promise<Candle1m[]> {
  const symbol = `${asset}USDT`;
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit}`, { cache: 'no-store', signal: AbortSignal.timeout(7000) });
  if (!res.ok) return [];
  const rows = await res.json() as Array<[number, string, string, string, string]>;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({ timestamp: Math.floor(r[0] / 1000), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]) })).filter((c) => Number.isFinite(c.close));
}
