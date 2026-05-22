import type { Asset, Candle1m } from './types';

export async function fetchBinanceCandles1mForWindow(
  asset: Asset,
  windowStart: number,
  windowEnd: number,
): Promise<Candle1m[]> {
  const symbol = `${asset}USDT`;
  const startTime = windowStart * 1000;
  const endTime = Math.min(Date.now(), windowEnd * 1000);

  const url = new URL('https://api.binance.com/api/v3/klines');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', '1m');
  url.searchParams.set('startTime', String(startTime));
  url.searchParams.set('endTime', String(endTime));
  url.searchParams.set('limit', '1000');

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];

  const rows = (await res.json()) as Array<[number, string, string, string, string]>;
  if (!Array.isArray(rows)) return [];

  return rows
    .map((r) => ({
      timestamp: Math.floor(r[0] / 1000),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
    }))
    .filter(
      (c) =>
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close),
    );
}
