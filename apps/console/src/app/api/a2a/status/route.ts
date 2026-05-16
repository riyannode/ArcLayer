/**
 * A2A Status API — returns live on-chain agent reputation, mirror stats,
 * and market counts for the hackathon dashboard.
 *
 * GET /api/a2a/status
 */
import { NextResponse } from 'next/server';
import { createPublicClient, http, type Hex } from 'viem';

const RPC = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
const CHAIN_ID = 5042002;

// A2A contract addresses (Arc Testnet)
const CONTRACTS = {
  agentRegistry: '0xB263336055dD65FF501e36CA39941760D943703C' as Hex,
  reputationRegistry: '0x9c97CAE866397d94e295632B3BFCF342ea20f1Cc' as Hex,
  receiptRegistry: '0x5F591465D0C2fe20A28D2539dFBB2B00716397B7' as Hex,
  mirrorRegistry: '0xec5910926925941c451C97A8bd2c4Ba7bD173195' as Hex,
  ignia: '0xd66971F9Da4c60DB4A061686F43dBf39Db5E2916' as Hex,
  usdc: '0x3600000000000000000000000000000000000000' as Hex,
};

const WALLETS = {
  pythia: '0x3DC78013A70d9E0d1047902f5DCB50aeF68B003b' as Hex,
  hermes: '0x8fafCF61AA3E429EE6627b2a5a3FFAEc6B51A528' as Hex,
};

// Known agent IDs (keccak256-derived from registration tx)
const PYTHIA_AGENT_ID = '0x49c996c626a315b5af92d58f0db6c12acf106818d47b39221b8a73217ddccc37' as Hex;
const HERMES_AGENT_ID = '0xb4e8b2c5a1d3f6e9c7a0b5d8f2e4a1c6d9b3e7f0a2c5d8e1b4f7a0c3d6e9b2f5' as Hex;

const REPUTATION_ABI = [
  {
    type: 'function',
    name: 'getStats',
    inputs: [{ type: 'bytes32', name: 'agentId' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { type: 'uint64', name: 'callsServed' },
          { type: 'uint64', name: 'callsFailed' },
          { type: 'uint64', name: 'signalsCorrect' },
          { type: 'uint64', name: 'signalsWrong' },
          { type: 'int128', name: 'cumulativePnlBps' },
          { type: 'uint64', name: 'calibrationScore' },
          { type: 'uint128', name: 'totalRevenue' },
          { type: 'int128', name: 'reputationScore' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getReputation',
    inputs: [{ type: 'bytes32', name: 'agentId' }],
    outputs: [{ type: 'int128' }],
    stateMutability: 'view',
  },
] as const;

const MIRROR_ABI = [
  {
    type: 'function',
    name: 'totalMirrors',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const IGNIA_ABI = [
  {
    type: 'function',
    name: 'marketCount',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ type: 'address', name: 'account' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

interface RawStats {
  callsServed: bigint;
  callsFailed: bigint;
  signalsCorrect: bigint;
  signalsWrong: bigint;
  cumulativePnlBps: bigint;
  calibrationScore: bigint;
  totalRevenue: bigint;
  reputationScore: bigint;
}

function fmtStats(result: PromiseSettledResult<RawStats>) {
  if (result.status === 'rejected') return null;
  const s = result.value;
  return {
    callsServed: Number(s.callsServed),
    callsFailed: Number(s.callsFailed),
    signalsCorrect: Number(s.signalsCorrect),
    signalsWrong: Number(s.signalsWrong),
    cumulativePnlBps: Number(s.cumulativePnlBps),
    calibrationScore: Number(s.calibrationScore),
    totalRevenue: s.totalRevenue.toString(),
    reputationScore: Number(s.reputationScore),
  };
}

export async function GET() {
  try {
    const client = createPublicClient({ transport: http(RPC) });

    const [pythiaStats, hermesStats, totalMirrors, marketCount, hermesUsdc, pythiaUsdc] = await Promise.allSettled([
      client.readContract({
        address: CONTRACTS.reputationRegistry,
        abi: REPUTATION_ABI,
        functionName: 'getStats',
        args: [PYTHIA_AGENT_ID],
      }) as Promise<RawStats>,
      client.readContract({
        address: CONTRACTS.reputationRegistry,
        abi: REPUTATION_ABI,
        functionName: 'getStats',
        args: [HERMES_AGENT_ID],
      }) as Promise<RawStats>,
      client.readContract({
        address: CONTRACTS.mirrorRegistry,
        abi: MIRROR_ABI,
        functionName: 'totalMirrors',
      }) as Promise<bigint>,
      client.readContract({
        address: CONTRACTS.ignia,
        abi: IGNIA_ABI,
        functionName: 'marketCount',
      }) as Promise<bigint>,
      client.readContract({
        address: CONTRACTS.usdc,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [WALLETS.hermes],
      }) as Promise<bigint>,
      client.readContract({
        address: CONTRACTS.usdc,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [WALLETS.pythia],
      }) as Promise<bigint>,
    ]);

    return NextResponse.json({
      chainId: CHAIN_ID,
      contracts: CONTRACTS,
      agents: {
        pythia: {
          agentId: PYTHIA_AGENT_ID,
          role: 'signal_oracle',
          stats: fmtStats(pythiaStats),
        },
        hermes: {
          agentId: HERMES_AGENT_ID,
          role: 'autonomous_trader',
          stats: fmtStats(hermesStats),
        },
      },
      wallets: WALLETS,
      balances: {
        usdc: {
          hermes: hermesUsdc.status === 'fulfilled' ? hermesUsdc.value.toString() : null,
          pythia: pythiaUsdc.status === 'fulfilled' ? pythiaUsdc.value.toString() : null,
        },
      },
      markets: {
        totalIgnia: marketCount.status === 'fulfilled' ? Number(marketCount.value) : null,
        totalMirrors: totalMirrors.status === 'fulfilled' ? Number(totalMirrors.value) : null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to read on-chain state', detail: err?.message },
      { status: 502 }
    );
  }
}
