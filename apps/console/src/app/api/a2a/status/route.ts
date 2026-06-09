import { humanJson } from '@/lib/api/human-json';
/**
 * A2A Status API — returns aggregate on-chain registry and mirror status.
 *
 * GET /api/a2a/status
 */
import { NextRequest } from 'next/server';
import { createPublicClient, http, type Hex } from 'viem';
import { CONTRACTS as SDK_CONTRACTS } from '@arclayer/sdk';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const STATUS_TTL_MS = 30_000;
const STATUS_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120';
let statusCache: { expiresAt: number; payload: unknown } | null = null;

const RPC = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
const CHAIN_ID = 5042002;

// Mirror registry — not in SDK, legacy contract for totalMirrors() reads
const MIRROR_REGISTRY = '0xec5910926925941c451C97A8bd2c4Ba7bD173195' as Hex;

// Explicit lowercase keys for API consumers (SDK uses UPPERCASE internally)

const MIRROR_ABI = [
  {
    type: 'function',
    name: 'totalMirrors',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export async function GET(req: NextRequest) {
  try {
    if (statusCache && statusCache.expiresAt > Date.now()) {
      return humanJson(req, statusCache.payload, {
        headers: { 'Cache-Control': STATUS_CACHE_CONTROL },
      });
    }
    const client = createPublicClient({ transport: http(RPC) });

    const totalMirrors = await client.readContract({
      address: MIRROR_REGISTRY,
      abi: MIRROR_ABI,
      functionName: 'totalMirrors',
    }).catch(() => null);

    const payload = {
      chainId: CHAIN_ID,
      contracts: {
        identityRegistry: SDK_CONTRACTS.ERC8004_IDENTITY_REGISTRY,
        reputationRegistry: SDK_CONTRACTS.ERC8004_REPUTATION_REGISTRY,
        validationRegistry: SDK_CONTRACTS.ERC8004_VALIDATION_REGISTRY,
        agenticCommerce: SDK_CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        usdc: SDK_CONTRACTS.USDC,
        mirrorRegistry: MIRROR_REGISTRY,
      },
      markets: {
        totalMirrors: totalMirrors === null ? null : Number(totalMirrors),
      },
      timestamp: new Date().toISOString(),
    };
    statusCache = { expiresAt: Date.now() + STATUS_TTL_MS, payload };
    return humanJson(req, payload, {
      headers: { 'Cache-Control': STATUS_CACHE_CONTROL },
    });
  } catch (err: any) {
    return humanJson(req, { error: 'Failed to read on-chain state', detail: err?.message }, { status: 502, headers: { 'Cache-Control': STATUS_CACHE_CONTROL } });
  }
}
