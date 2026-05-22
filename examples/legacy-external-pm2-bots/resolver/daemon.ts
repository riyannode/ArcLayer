/**
 * ArcLayer Resolver Daemon
 *
 * Watches MarketMirrorRegistry, resolves expired Ignia markets via Pythia,
 * then records outcome-based reputation for provider/trader agents on-chain.
 */
import * as dotenv from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Address } from 'viem';
import { readMarket, IgniaOutcome } from '../shared/ignia.js';
import { resolveIgniaWithPythia } from '../pythia/resolver.js';
import {
  a2aPublicClient,
  getAllMirrors,
  getReputation,
  getStats,
  markMirrorResolved,
  recordSignalOutcome,
  recordTraderOutcome,
} from '../contracts/a2a-client.js';
import { A2A_CONTRACTS } from '../contracts/addresses.js';
import { MARKET_MIRROR_REGISTRY_ABI } from '../contracts/abis.js';

// Load agents/.env regardless of cwd.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

type Hex32 = `0x${string}`;

interface AgentIds {
  pythia?: { agentId: Hex32; address: Address };
  hermes?: { agentId: Hex32; address: Address };
  resolver?: { agentId: Hex32; address: Address };
}

interface MirrorTuple {
  slugHash: Hex32;
  slug: string;
  asset: string;
  igniaMarketId: bigint;
  createdAt: bigint | number;
  deadline: bigint | number;
  resolved: boolean;
  outcome: number;
}

interface ResolverState {
  resolvedMirrors: Record<string, {
    marketId: string;
    outcome: number;
    resolveTx?: string;
    mirrorTx?: string;
    signalRepTx?: string;
    traderRepTx?: string;
    resolvedAt: number;
  }>;
}

const PRIVATE_KEY = process.env.PYTHIA_ORACLE_PRIVATE_KEY as Hex32 | undefined;
const POLL_MS = Number(process.env.RESOLVER_POLL_MS ?? 60_000);
const DRY_RUN = process.env.RESOLVER_DRY_RUN === 'true';
const STATE_PATH = process.env.RESOLVER_STATE_PATH ?? join(__dirname, '..', 'data', 'resolver-state.json');
const AGENT_IDS_PATH = join(__dirname, '..', 'contracts', 'agent-ids.json');

function loadAgentIds(): AgentIds {
  if (!existsSync(AGENT_IDS_PATH)) throw new Error(`agent ids missing: ${AGENT_IDS_PATH}`);
  return JSON.parse(readFileSync(AGENT_IDS_PATH, 'utf8')) as AgentIds;
}

function loadState(): ResolverState {
  if (!existsSync(STATE_PATH)) return { resolvedMirrors: {} };
  return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as ResolverState;
}

function saveState(state: ResolverState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function getMirror(slugHash: Hex32): Promise<MirrorTuple> {
  return await a2aPublicClient.readContract({
    address: A2A_CONTRACTS.MarketMirrorRegistry,
    abi: MARKET_MIRROR_REGISTRY_ABI,
    functionName: 'getMirror',
    args: [slugHash],
  }) as MirrorTuple;
}

function toOutcomeName(outcome: IgniaOutcome | number): 'YES' | 'NO' | 'UNRESOLVED' {
  if (Number(outcome) === IgniaOutcome.YES) return 'YES';
  if (Number(outcome) === IgniaOutcome.NO) return 'NO';
  return 'UNRESOLVED';
}

function computeTraderPnlBps(outcome: IgniaOutcome, side: 'YES' | 'NO' | 'SKIP'): bigint {
  if (side === 'SKIP' || outcome === IgniaOutcome.UNRESOLVED) return 0n;
  const won = (side === 'YES' && outcome === IgniaOutcome.YES) || (side === 'NO' && outcome === IgniaOutcome.NO);
  // Demo accounting: full binary payout approximation.
  return won ? 10_000n : -10_000n;
}

function inferSignalSide(question: string): 'YES' | 'NO' | 'SKIP' {
  // Resolver does not persist per-receipt signal bodies yet. For demo reputation,
  // infer Pythia's recommended side from market wording when available.
  const q = question.toUpperCase();
  if (q.includes(' BUY ') || q.includes(' BULL ') || q.includes(' ABOVE ') || q.includes(' > ')) return 'YES';
  if (q.includes(' SELL ') || q.includes(' BEAR ') || q.includes(' BELOW ') || q.includes(' < ')) return 'NO';
  return 'SKIP';
}

async function processMirror(slugHash: Hex32, state: ResolverState, agentIds: AgentIds): Promise<void> {
  const mirror = await getMirror(slugHash);
  const key = slugHash.toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  if (!mirror.slug || Number(mirror.createdAt) === 0) return;
  if (mirror.resolved || state.resolvedMirrors[key]) return;
  if (now < Number(mirror.deadline)) return;

  const marketId = BigInt(mirror.igniaMarketId);
  const market = await readMarket(marketId);

  console.log(`[Resolver] expired mirror=${mirror.slug} market=${marketId} question="${market.question}"`);

  const result = await resolveIgniaWithPythia(PRIVATE_KEY!, marketId, { dryRun: DRY_RUN });
  if (result.status !== 'resolved' || result.decision.outcome === IgniaOutcome.UNRESOLVED) {
    console.log(`[Resolver] skip market=${marketId} status=${result.status} reason=${result.decision.reasoning}`);
    return;
  }

  let mirrorTx: string | undefined;
  let signalRepTx: string | undefined;
  let traderRepTx: string | undefined;

  if (!DRY_RUN) {
    mirrorTx = await markMirrorResolved(PRIVATE_KEY!, slugHash, result.decision.outcome as 1 | 2);
    console.log(`[Resolver] mirror resolved tx=${mirrorTx}`);

    const pythiaAgentId = agentIds.pythia?.agentId;
    const hermesAgentId = agentIds.hermes?.agentId;
    if (pythiaAgentId) {
      const inferredSide = inferSignalSide(market.question);
      const wasCorrect = inferredSide === 'SKIP'
        ? true
        : (inferredSide === 'YES' && result.decision.outcome === IgniaOutcome.YES) ||
          (inferredSide === 'NO' && result.decision.outcome === IgniaOutcome.NO);
      const pnlBps = wasCorrect ? 1_000n : -1_000n;
      signalRepTx = await recordSignalOutcome(PRIVATE_KEY!, pythiaAgentId, slugHash, wasCorrect, pnlBps, 80n);
      console.log(`[Resolver] pythia reputation tx=${signalRepTx} correct=${wasCorrect}`);
    }

    if (hermesAgentId) {
      const side = inferSignalSide(market.question);
      const pnlBps = computeTraderPnlBps(result.decision.outcome, side);
      traderRepTx = await recordTraderOutcome(PRIVATE_KEY!, hermesAgentId, slugHash, pnlBps, side !== 'SKIP', true);
      console.log(`[Resolver] hermes reputation tx=${traderRepTx} side=${side} pnlBps=${pnlBps}`);
    }
  }

  state.resolvedMirrors[key] = {
    marketId: marketId.toString(),
    outcome: result.decision.outcome,
    resolveTx: result.txHash,
    mirrorTx,
    signalRepTx,
    traderRepTx,
    resolvedAt: now,
  };
  saveState(state);

  console.log(`[Resolver] done market=${marketId} outcome=${toOutcomeName(result.decision.outcome)} resolveTx=${result.txHash ?? 'dry-run'}`);

  if (agentIds.pythia?.agentId) {
    const [rep, stats] = await Promise.all([getReputation(agentIds.pythia.agentId), getStats(agentIds.pythia.agentId)]);
    console.log(`[Resolver] Pythia reputation=${rep} stats=${JSON.stringify(stats, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`);
  }
}

async function tick(): Promise<void> {
  if (!PRIVATE_KEY && !DRY_RUN) throw new Error('PYTHIA_ORACLE_PRIVATE_KEY missing');
  const agentIds = loadAgentIds();
  const state = loadState();
  const slugs = await getAllMirrors();
  console.log(`[Resolver] scan mirrors=${slugs.length} dryRun=${DRY_RUN}`);

  for (const slugHash of slugs) {
    try {
      await processMirror(slugHash, state, agentIds);
    } catch (err: any) {
      console.error(`[Resolver] mirror error ${slugHash}:`, err?.message ?? err);
    }
  }
}

async function main(): Promise<void> {
  console.log(`[Resolver] starting pollMs=${POLL_MS} state=${STATE_PATH}`);
  process.on('unhandledRejection', (err) => console.error('[Resolver] unhandledRejection', err));
  process.on('uncaughtException', (err) => {
    console.error('[Resolver] uncaughtException', err);
    setTimeout(() => process.exit(1), 500);
  });

  await tick();
  setInterval(() => void tick().catch((err) => console.error('[Resolver] tick error:', err?.message ?? err)), POLL_MS);
}

void main();
