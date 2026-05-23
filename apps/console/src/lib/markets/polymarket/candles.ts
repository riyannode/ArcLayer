import { createPublicClient, formatUnits, http, isAddress, type Address } from 'viem';
import type { Asset, Candle1m, CandleFetchResult, ChainlinkPricePoint } from './types';

const aggregatorV3Abi = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  {
    type: 'function',
    name: 'getRoundData',
    stateMutability: 'view',
    inputs: [{ name: 'roundId', type: 'uint80' }],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const;

function getFeedAddress(asset: Asset): Address {
  const candidate = asset === 'BTC' ? process.env.CHAINLINK_BTC_USD_FEED : process.env.CHAINLINK_ETH_USD_FEED;
  if (!candidate) throw new Error(`chainlink_feed_missing_${asset}`);
  if (!isAddress(candidate)) throw new Error(`chainlink_feed_invalid_${asset}`);
  return candidate;
}

function buildCandles1m(points: ChainlinkPricePoint[], windowStart: number, windowEnd: number): Candle1m[] {
  if (!points.length) return [];

  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const firstTs = sorted[0].timestamp;
  const lastTs = sorted[sorted.length - 1].timestamp;
  const start = Math.max(windowStart, Math.floor(firstTs / 60) * 60);
  const end = Math.min(windowEnd, Math.floor(lastTs / 60) * 60 + 59);
  if (end < start) return [];

  const byMinute = new Map<number, ChainlinkPricePoint[]>();
  for (const point of sorted) {
    if (point.timestamp < start || point.timestamp > end) continue;
    const bucket = Math.floor(point.timestamp / 60) * 60;
    const existing = byMinute.get(bucket);
    if (existing) existing.push(point);
    else byMinute.set(bucket, [point]);
  }

  const candles: Candle1m[] = [];
  let previousClose: number | null = null;
  for (let minute = Math.floor(start / 60) * 60; minute <= end; minute += 60) {
    const pointsInMinute = byMinute.get(minute);
    if (pointsInMinute && pointsInMinute.length) {
      pointsInMinute.sort((a, b) => a.timestamp - b.timestamp);
      const open = pointsInMinute[0].price;
      const close = pointsInMinute[pointsInMinute.length - 1].price;
      const high = Math.max(...pointsInMinute.map((p) => p.price));
      const low = Math.min(...pointsInMinute.map((p) => p.price));
      candles.push({ timestamp: minute, open, high, low, close });
      previousClose = close;
      continue;
    }

    if (previousClose !== null && minute >= windowStart && minute <= windowEnd) {
      candles.push({ timestamp: minute, open: previousClose, high: previousClose, low: previousClose, close: previousClose });
    }
  }

  return candles;
}

async function fetchChainlinkPricePointsForWindow(asset: Asset, windowStart: number, windowEnd: number): Promise<{ points: ChainlinkPricePoint[]; diagnostics: string[] }> {
  const rpcUrl = process.env.CHAINLINK_EVM_RPC_URL;
  if (!rpcUrl) throw new Error('chainlink_rpc_missing');

  const client = createPublicClient({ transport: http(rpcUrl) });
  const address = getFeedAddress(asset);
  const decimals = await client.readContract({ address, abi: aggregatorV3Abi, functionName: 'decimals' });
  const latest = await client.readContract({ address, abi: aggregatorV3Abi, functionName: 'latestRoundData' });

  const points: ChainlinkPricePoint[] = [];
  const diagnostics: string[] = [];
  let roundId = latest[0] as bigint;
  const maxRounds = 1200;
  const maxReadFailures = 32;
  let readFailures = 0;

  for (let scanned = 0; scanned < maxRounds && roundId > 0n; scanned += 1) {
    let data: typeof latest;
    if (scanned === 0) {
      data = latest;
    } else {
      try {
        data = await client.readContract({ address, abi: aggregatorV3Abi, functionName: 'getRoundData', args: [roundId] });
      } catch {
        readFailures += 1;
        if (readFailures <= 3) diagnostics.push(`chainlink_round_read_failed_${roundId.toString()}`);
        if (readFailures >= maxReadFailures) {
          diagnostics.push('chainlink_round_read_failure_limit_reached');
          break;
        }
        roundId -= 1n;
        continue;
      }
    }

    const answer = data[1] as bigint;
    const updatedAt = Number(data[3]);
    if (updatedAt > 0 && answer > 0n) {
      const price = Number(formatUnits(answer, decimals));
      if (Number.isFinite(price)) {
        points.push({ timestamp: updatedAt, price, roundId: String(data[0]) });
      }
    }

    if (updatedAt > 0 && updatedAt < windowStart - 900) {
      break;
    }

    roundId -= 1n;
  }

  return {
    points: points.filter((point) => point.timestamp >= windowStart - 900 && point.timestamp <= windowEnd + 900),
    diagnostics,
  };
}

export async function fetchChainlinkCandles1mForWindow(asset: Asset, windowStart: number, windowEnd: number): Promise<CandleFetchResult> {
  try {
    const { points: pricePoints, diagnostics } = await fetchChainlinkPricePointsForWindow(asset, windowStart, windowEnd);
    const candles = buildCandles1m(pricePoints, windowStart, windowEnd);
    if (!candles.length) {
      return { candles: [], candleSource: 'none', candleError: 'chainlink_no_rounds_for_window', pricePoints: [] };
    }
    return { candles, candleSource: 'chainlink', candleError: diagnostics.length ? diagnostics.join('; ') : null, pricePoints };
  } catch (error) {
    return {
      candles: [],
      candleSource: 'none',
      candleError: error instanceof Error ? error.message : 'chainlink_unavailable',
      pricePoints: [],
    };
  }
}
