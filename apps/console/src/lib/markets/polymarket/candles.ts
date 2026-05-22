import type { Asset, Candle1m, CandleFetchResult } from './types';

function isFiniteCandle(c: Candle1m) {
  return Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close);
}

async function fetchBinance(asset: Asset, windowStart: number, windowEnd: number): Promise<Candle1m[]> {
  const symbol = `${asset}USDT`;
  const startTime = windowStart * 1000;
  const endTime = Math.min(Date.now(), windowEnd * 1000);

  const url = new URL('https://api.binance.com/api/v3/klines');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', '1m');
  url.searchParams.set('startTime', String(startTime));
  url.searchParams.set('endTime', String(endTime));
  url.searchParams.set('limit', '1000');

  const res = await fetch(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
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
    .filter(isFiniteCandle);
}

async function fetchCoinbase(asset: Asset, windowStart: number, windowEnd: number): Promise<Candle1m[]> {
  const product = `${asset}-USD`;
  const startIso = new Date(windowStart * 1000).toISOString();
  const endIso = new Date(Math.min(Date.now(), windowEnd * 1000)).toISOString();
  const url = new URL(`https://api.exchange.coinbase.com/products/${product}/candles`);
  url.searchParams.set('granularity', '60');
  url.searchParams.set('start', startIso);
  url.searchParams.set('end', endIso);

  const res = await fetch(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];

  const rows = (await res.json()) as Array<[number, number, number, number, number, number]>;
  if (!Array.isArray(rows)) return [];

  return rows
    .map((r) => ({ timestamp: Number(r[0]), low: Number(r[1]), high: Number(r[2]), open: Number(r[3]), close: Number(r[4]) }))
    .filter(isFiniteCandle)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function fetchCandles1mForWindow(asset: Asset, windowStart: number, windowEnd: number): Promise<CandleFetchResult> {
  try {
    const binance = await fetchBinance(asset, windowStart, windowEnd);
    if (binance.length > 0) return { candles: binance, candleSource: 'binance', candleError: null };
  } catch {
    // fallback below
  }

  try {
    const coinbase = await fetchCoinbase(asset, windowStart, windowEnd);
    if (coinbase.length > 0) return { candles: coinbase, candleSource: 'coinbase', candleError: null };
  } catch {
    // fail below
  }

  return {
    candles: [],
    candleSource: 'none',
    candleError: 'binance_and_coinbase_empty_or_failed',
  };
}
