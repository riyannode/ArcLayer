/**
 * Market Scanner — autonomous Polymarket → Ignia mirror daemon.
 *
 * Polls Polymarket Gamma API for active 5m crypto UP/DOWN markets.
 * For each new slug:
 *   1. Create matching Ignia market on Arc (binary YES/NO)
 *   2. Register slug → igniaMarketId mapping in MarketMirrorRegistry
 *
 * Runs as a PM2 daemon. Idempotent — skips slugs that already have mirrors.
 */
import 'dotenv/config';
import { parseUnits } from 'viem';
import {
  registerMirror,
  mirrorExists,
  createA2AWallet,
  a2aPublicClient,
} from '../contracts/a2a-client.js';
import {
  IGNIA_ABI,
  IGNIA_ADDRESS,
  USDC_ADDRESS,
  ERC20_ABI,
  USDC_DECIMALS,
} from '../shared/ignia.js';
import { arcTestnet } from '../shared/x402-client.js';

const PRIVATE_KEY = process.env.PYTHIA_ORACLE_PRIVATE_KEY as `0x${string}` | undefined;
const POLL_INTERVAL_MS = Number(process.env.SCANNER_INTERVAL_MS ?? 30000);
const MAX_MARKETS_PER_TICK = Number(process.env.SCANNER_MAX_PER_TICK ?? 3);
const SEED_USDC = process.env.SCANNER_SEED_USDC ?? '1.0';
const POLYMARKET_GAMMA = 'https://gamma-api.polymarket.com/markets';
const ASSETS = (process.env.SCANNER_ASSETS ?? 'BTC,ETH,SOL').split(',').map(s => s.trim().toUpperCase());

if (!PRIVATE_KEY) {
  console.error('Missing PYTHIA_ORACLE_PRIVATE_KEY');
  process.exit(1);
}

interface PolymarketMarket {
  slug: string;
  question: string;
  endDate?: string;
  closed?: boolean;
  active?: boolean;
}

async function fetchPolymarketMarkets(asset: string): Promise<PolymarketMarket[]> {
  // 5m UP/DOWN markets follow slug pattern: <asset>-up-or-down-...
  const url = `${POLYMARKET_GAMMA}?active=true&closed=false&limit=20&tag_id=735&order=volume24hr&ascending=false&search=${asset}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[scanner] polymarket fetch ${asset} failed: ${res.status}`);
      return [];
    }
    const json = (await res.json()) as PolymarketMarket[];
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.warn(`[scanner] polymarket fetch ${asset} error:`, (err as Error).message);
    return [];
  }
}

function detectAsset(slug: string): string | null {
  const s = slug.toLowerCase();
  for (const asset of ASSETS) {
    if (s.includes(asset.toLowerCase())) return asset;
  }
  return null;
}

async function ensureUsdcAllowanceForIgnia(amount: bigint): Promise<void> {
  const { account, wallet } = createA2AWallet(PRIVATE_KEY!);
  const allowance = await a2aPublicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, IGNIA_ADDRESS],
  });
  if (allowance >= amount) return;
  console.log(`[scanner] approving ${amount} USDC to Ignia...`);
  const hash = await wallet.writeContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [IGNIA_ADDRESS, amount * 100n],
    account,
    chain: arcTestnet,
  });
  await a2aPublicClient.waitForTransactionReceipt({ hash, timeout: 300_000, pollingInterval: 2_000 });
}

async function createIgniaMarket(question: string, deadline: bigint): Promise<bigint> {
  const seed = parseUnits(SEED_USDC, USDC_DECIMALS);
  await ensureUsdcAllowanceForIgnia(seed);
  const { account, wallet } = createA2AWallet(PRIVATE_KEY!);
  const txHash = await wallet.writeContract({
    address: IGNIA_ADDRESS,
    abi: IGNIA_ABI,
    functionName: 'createMarket',
    args: [question, deadline, seed],
    account,
    chain: arcTestnet,
  });
  const receipt = await a2aPublicClient.waitForTransactionReceipt({ hash: txHash, timeout: 300_000, pollingInterval: 2_000 });
  // Read marketCount-1 to get the new id (createMarket increments)
  const count = (await a2aPublicClient.readContract({
    address: IGNIA_ADDRESS,
    abi: IGNIA_ABI,
    functionName: 'marketCount',
  })) as bigint;
  const marketId = count - 1n;
  console.log(`[scanner] created Ignia market #${marketId} tx=${txHash} (block=${receipt.blockNumber})`);
  return marketId;
}

async function processMarket(pm: PolymarketMarket): Promise<void> {
  if (!pm.slug || !pm.question) return;
  if (pm.closed) return;

  const asset = detectAsset(pm.slug);
  if (!asset) return;

  // Skip already mirrored
  if (await mirrorExists(pm.slug)) return;

  const endTs = pm.endDate ? Math.floor(new Date(pm.endDate).getTime() / 1000) : Math.floor(Date.now() / 1000) + 600;
  const minDeadline = Math.floor(Date.now() / 1000) + 300;
  if (endTs <= minDeadline) {
    console.log(`[scanner] skip ${pm.slug} — deadline too close`);
    return;
  }
  const deadline = BigInt(endTs);

  console.log(`\n[scanner] mirroring slug=${pm.slug} asset=${asset} deadline=${endTs}`);

  try {
    const igniaMarketId = await createIgniaMarket(pm.question, deadline);
    const { txHash, slugHash } = await registerMirror(PRIVATE_KEY!, pm.slug, asset, igniaMarketId, deadline);
    console.log(`[scanner] registered mirror slugHash=${slugHash} igniaMarketId=${igniaMarketId} tx=${txHash}`);
  } catch (err) {
    console.error(`[scanner] failed to mirror ${pm.slug}:`, (err as Error).message);
  }
}

async function tick(): Promise<void> {
  let mirroredThisTick = 0;
  for (const asset of ASSETS) {
    if (mirroredThisTick >= MAX_MARKETS_PER_TICK) break;
    const markets = await fetchPolymarketMarkets(asset);
    for (const m of markets) {
      if (mirroredThisTick >= MAX_MARKETS_PER_TICK) break;
      const before = mirroredThisTick;
      await processMarket(m);
      // Check if it was actually mirrored (via post-check)
      if (await mirrorExists(m.slug)) {
        if (before === mirroredThisTick) mirroredThisTick++;
      }
    }
  }
}

async function main(): Promise<void> {
  console.log('[scanner] Polymarket → Ignia market scanner started');
  console.log(`[scanner] poll=${POLL_INTERVAL_MS}ms assets=${ASSETS.join(',')} maxPerTick=${MAX_MARKETS_PER_TICK}`);

  // Initial run
  await tick().catch(err => console.error('[scanner] tick error:', err));

  setInterval(() => {
    tick().catch(err => console.error('[scanner] tick error:', err));
  }, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error('[scanner] fatal:', err);
  process.exit(1);
});
