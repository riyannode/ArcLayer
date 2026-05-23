import type { Asset, Candle1m, CandleFetchResult } from './types';

function parseRows(rows: unknown, mapRow: (row: any) => Candle1m): Candle1m[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(mapRow)
    .filter(
      (c) =>
        Number.isFinite(c.timestamp) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close),
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchBinanceCandles(asset: Asset, windowStart: number, windowEnd: number): Promise<Candle1m[]> {
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
  if (!res.ok) throw new Error(`Binance ${res.status}`);

  const rows = (await res.json()) as Array<[number, string, string, string, string]>;
  return parseRows(rows, (r) => ({
    timestamp: Math.floor(Number(r[0]) / 1000),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
  }));
}

async function fetchCoinbaseCandles(asset: Asset, windowStart: number, windowEnd: number): Promise<Candle1m[]> {
  const product = asset === 'BTC' ? 'BTC-USD' : 'ETH-USD';
  const startIso = new Date(windowStart * 1000).toISOString();
  const endIso = new Date(Math.min(Date.now(), windowEnd * 1000)).toISOString();

  const url = new URL(`https://api.exchange.coinbase.com/products/${product}/candles`);
  url.searchParams.set('granularity', '60');
  url.searchParams.set('start', startIso);
  url.searchParams.set('end', endIso);

  const res = await fetch(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Coinbase ${res.status}`);

  const rows = (await res.json()) as Array<[number, number, number, number, number, number]>;
  return parseRows(rows, (r) => ({
    timestamp: Number(r[0]),
    low: Number(r[1]),
    high: Number(r[2]),
    open: Number(r[3]),
    close: Number(r[4]),
  }));
}

export async function fetchCandles1mForWindow(
  asset: Asset,
  windowStart: number,
  windowEnd: number,
): Promise<CandleFetchResult> {
  const errors: string[] = [];

  try {
    const candles = await fetchBinanceCandles(asset, windowStart, windowEnd);
    if (candles.length) return { candles, candleSource: 'binance', candleError: null };
    errors.push('Binance returned empty candles');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Binance request failed');
  }

  try {
    const candles = await fetchCoinbaseCandles(asset, windowStart, windowEnd);
    if (candles.length) return { candles, candleSource: 'coinbase', candleError: null };
    errors.push('Coinbase returned empty candles');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Coinbase request failed');
  }

  return { candles: [], candleSource: 'none', candleError: errors.length ? errors.join('; ') : 'Candle sources unavailable' };
}
