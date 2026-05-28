/**
 * A2A Status API — returns aggregate on-chain registry and mirror status.
 *
 * GET /api/a2a/status
 */
import { NextResponse } from 'next/server';
import { createPublicClient, http, type Hex } from 'viem';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const STATUS_TTL_MS = 30_000;
const STATUS_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120';
let statusCache: { expiresAt: number; payload: unknown } | null = null;

const RPC = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
const CHAIN_ID = 5042002;

// A2A contract addresses (Arc Testnet)
const CONTRACTS = {
  agentRegistry: '0xB263336055dD65FF501e36CA39941760D943703C' as Hex,
  reputationRegistry: '0x9c97CAE866397d94e295632B3BFCF342ea20f1Cc' as Hex,
  receiptRegistry: '0x5F591465D0C2fe20A28D2539dFBB2B00716397B7' as Hex,
  mirrorRegistry: '0xec5910926925941c451C97A8bd2c4Ba7bD173195' as Hex,
  usdc: '0x3600000000000000000000000000000000000000' as Hex,
};

const MIRROR_ABI = [
  {
    type: 'function',
    name: 'totalMirrors',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export async function GET() {
  try {
    if (statusCache && statusCache.expiresAt > Date.now()) {
      return NextResponse.json(statusCache.payload, {
        headers: { 'Cache-Control': STATUS_CACHE_CONTROL },
      });
    }
    const client = createPublicClient({ transport: http(RPC) });

    const totalMirrors = await client.readContract({
      address: CONTRACTS.mirrorRegistry,
      abi: MIRROR_ABI,
      functionName: 'totalMirrors',
    }).catch(() => null);

    const payload = {
      chainId: CHAIN_ID,
      contracts: CONTRACTS,
      markets: {
        totalMirrors: totalMirrors === null ? null : Number(totalMirrors),
      },
      timestamp: new Date().toISOString(),
    };
    statusCache = { expiresAt: Date.now() + STATUS_TTL_MS, payload };
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': STATUS_CACHE_CONTROL },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to read on-chain state', detail: err?.message },
      { status: 502, headers: { 'Cache-Control': STATUS_CACHE_CONTROL } }
    );
  }
}
