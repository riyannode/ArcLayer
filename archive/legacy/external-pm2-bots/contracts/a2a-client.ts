// Shared A2A protocol client — wallet/public clients + helpers for the 4 A2A contracts
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from '../shared/x402-client.js';
import { A2A_CONTRACTS, ARC_TESTNET } from './addresses.js';
import {
  A2A_AGENT_REGISTRY_ABI,
  A2A_REPUTATION_REGISTRY_ABI,
  A2A_RECEIPT_REGISTRY_ABI,
  MARKET_MIRROR_REGISTRY_ABI,
} from './abis.js';

export enum AgentRole {
  MARKET_DATA = 0,
  TRADER = 1,
  EXECUTOR = 2,
  ORACLE = 3,
  AGGREGATOR = 4,
}

export enum Rail {
  ARC_NATIVE = 0,
  CIRCLE_GATEWAY = 1,
}

export const a2aPublicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET.rpc),
});

export function createA2AWallet(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_TESTNET.rpc) });
  return { account, wallet };
}

// ─── AgentRegistry ────────────────────────────────────────────────────

export async function registerAgent(
  privateKey: `0x${string}`,
  role: AgentRole,
  endpoint: string,
  metadataURI: string,
): Promise<{ txHash: Hash; agentId: `0x${string}` | null }> {
  const { account, wallet } = createA2AWallet(privateKey);
  const txHash = await wallet.writeContract({
    address: A2A_CONTRACTS.A2AAgentRegistry as Address,
    abi: A2A_AGENT_REGISTRY_ABI,
    functionName: 'registerAgent',
    args: [role, endpoint, metadataURI],
    account,
    chain: arcTestnet,
  });
  const receipt = await a2aPublicClient.waitForTransactionReceipt({ hash: txHash, timeout: 300_000, pollingInterval: 2_000 });

  // Parse AgentRegistered event for agentId
  // event AgentRegistered(bytes32 indexed agentId, address indexed owner, uint8 indexed role, ...)
  const eventTopic = '0x'; // we'll just get logs and find the matching event
  let agentId: `0x${string}` | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== A2A_CONTRACTS.A2AAgentRegistry.toLowerCase()) continue;
    if (log.topics.length >= 2 && log.topics[1]) {
      agentId = log.topics[1] as `0x${string}`;
      break;
    }
  }
  return { txHash, agentId };
}

export async function getAgent(agentId: `0x${string}`) {
  return a2aPublicClient.readContract({
    address: A2A_CONTRACTS.A2AAgentRegistry as Address,
    abi: A2A_AGENT_REGISTRY_ABI,
    functionName: 'getAgent',
    args: [agentId],
  });
}

export async function getAgentsByOwner(owner: Address): Promise<readonly `0x${string}`[]> {
  return (await a2aPublicClient.readContract({
    address: A2A_CONTRACTS.A2AAgentRegistry as Address,
    abi: A2A_AGENT_REGISTRY_ABI,
    functionName: 'getAgentsByOwner',
    args: [owner],
  })) as readonly `0x${string}`[];
}

export async function getAgentsByRole(role: AgentRole): Promise<readonly `0x${string}`[]> {
  return (await a2aPublicClient.readContract({
    address: A2A_CONTRACTS.A2AAgentRegistry as Address,
    abi: A2A_AGENT_REGISTRY_ABI,
    functionName: 'getAgentsByRole',
    args: [role],
  })) as readonly `0x${string}`[];
}

// ─── ReputationRegistry ───────────────────────────────────────────────

export async function recordInteraction(
  privateKey: `0x${string}`,
  providerAgentId: `0x${string}`,
  buyerAgentId: `0x${string}`,
  receiptHash: `0x${string}`,
  amount: bigint,
  delivered: boolean,
): Promise<Hash> {
  const { account, wallet } = createA2AWallet(privateKey);
  return wallet.writeContract({
    address: A2A_CONTRACTS.A2AReputationRegistry as Address,
    abi: A2A_REPUTATION_REGISTRY_ABI,
    functionName: 'recordInteraction',
    args: [providerAgentId, buyerAgentId, receiptHash, amount, delivered],
    account,
    chain: arcTestnet,
  });
}

export async function recordSignalOutcome(
  privateKey: `0x${string}`,
  providerAgentId: `0x${string}`,
  receiptHash: `0x${string}`,
  wasCorrect: boolean,
  pnlBps: bigint,
  confidence: bigint,
): Promise<Hash> {
  const { account, wallet } = createA2AWallet(privateKey);
  return wallet.writeContract({
    address: A2A_CONTRACTS.A2AReputationRegistry as Address,
    abi: A2A_REPUTATION_REGISTRY_ABI,
    functionName: 'recordSignalOutcome',
    args: [providerAgentId, receiptHash, wasCorrect, pnlBps, confidence],
    account,
    chain: arcTestnet,
  });
}

export async function recordTraderOutcome(
  privateKey: `0x${string}`,
  traderAgentId: `0x${string}`,
  receiptHash: `0x${string}`,
  pnlBps: bigint,
  executed: boolean,
  riskOk: boolean,
): Promise<Hash> {
  const { account, wallet } = createA2AWallet(privateKey);
  return wallet.writeContract({
    address: A2A_CONTRACTS.A2AReputationRegistry as Address,
    abi: A2A_REPUTATION_REGISTRY_ABI,
    functionName: 'recordTraderOutcome',
    args: [traderAgentId, receiptHash, pnlBps, executed, riskOk],
    account,
    chain: arcTestnet,
  });
}

export async function getReputation(agentId: `0x${string}`): Promise<bigint> {
  return (await a2aPublicClient.readContract({
    address: A2A_CONTRACTS.A2AReputationRegistry as Address,
    abi: A2A_REPUTATION_REGISTRY_ABI,
    functionName: 'getReputation',
    args: [agentId],
  })) as bigint;
}

export async function getStats(agentId: `0x${string}`) {
  return a2aPublicClient.readContract({
    address: A2A_CONTRACTS.A2AReputationRegistry as Address,
    abi: A2A_REPUTATION_REGISTRY_ABI,
    functionName: 'getStats',
    args: [agentId],
  });
}

// ─── ReceiptRegistry ──────────────────────────────────────────────────

export interface ReceiptStruct {
  providerAgentId: `0x${string}`;
  buyerAgentId: `0x${string}`;
  receiptHash: `0x${string}`;
  requestHash: `0x${string}`;
  responseHash: `0x${string}`;
  signalHash: `0x${string}`;
  amount: bigint;
  timestamp: bigint;
  rail: Rail;
  paymentRef: `0x${string}`;
  tradeTx: `0x${string}`;
  provider: Address;
  exists: boolean;
}

export async function anchorReceipt(
  privateKey: `0x${string}`,
  receipt: ReceiptStruct,
  providerSig: `0x${string}`,
): Promise<Hash> {
  const { account, wallet } = createA2AWallet(privateKey);
  return wallet.writeContract({
    address: A2A_CONTRACTS.A2AReceiptRegistry as Address,
    abi: A2A_RECEIPT_REGISTRY_ABI,
    functionName: 'anchorReceipt',
    args: [receipt, providerSig],
    account,
    chain: arcTestnet,
  });
}

export async function isReceiptAnchored(receiptHash: `0x${string}`): Promise<boolean> {
  return (await a2aPublicClient.readContract({
    address: A2A_CONTRACTS.A2AReceiptRegistry as Address,
    abi: A2A_RECEIPT_REGISTRY_ABI,
    functionName: 'isAnchored',
    args: [receiptHash],
  })) as boolean;
}

export async function getReceipt(receiptHash: `0x${string}`) {
  return a2aPublicClient.readContract({
    address: A2A_CONTRACTS.A2AReceiptRegistry as Address,
    abi: A2A_RECEIPT_REGISTRY_ABI,
    functionName: 'getReceipt',
    args: [receiptHash],
  });
}

// ─── MarketMirrorRegistry ─────────────────────────────────────────────

export async function registerMirror(
  privateKey: `0x${string}`,
  slug: string,
  asset: string,
  igniaMarketId: bigint,
  deadline: bigint,
): Promise<{ txHash: Hash; slugHash: `0x${string}` | null }> {
  const { account, wallet } = createA2AWallet(privateKey);
  const txHash = await wallet.writeContract({
    address: A2A_CONTRACTS.MarketMirrorRegistry as Address,
    abi: MARKET_MIRROR_REGISTRY_ABI,
    functionName: 'registerMirror',
    args: [slug, asset, igniaMarketId, deadline],
    account,
    chain: arcTestnet,
  });
  const receipt = await a2aPublicClient.waitForTransactionReceipt({ hash: txHash, timeout: 300_000, pollingInterval: 2_000 });
  let slugHash: `0x${string}` | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== A2A_CONTRACTS.MarketMirrorRegistry.toLowerCase()) continue;
    if (log.topics.length >= 2 && log.topics[1]) {
      slugHash = log.topics[1] as `0x${string}`;
      break;
    }
  }
  return { txHash, slugHash };
}

export async function markMirrorResolved(
  privateKey: `0x${string}`,
  slugHash: `0x${string}`,
  outcome: 1 | 2, // 1 = YES, 2 = NO
): Promise<Hash> {
  const { account, wallet } = createA2AWallet(privateKey);
  return wallet.writeContract({
    address: A2A_CONTRACTS.MarketMirrorRegistry as Address,
    abi: MARKET_MIRROR_REGISTRY_ABI,
    functionName: 'markResolved',
    args: [slugHash, outcome],
    account,
    chain: arcTestnet,
  });
}

export async function getMirrorBySlug(slug: string) {
  return a2aPublicClient.readContract({
    address: A2A_CONTRACTS.MarketMirrorRegistry as Address,
    abi: MARKET_MIRROR_REGISTRY_ABI,
    functionName: 'getMirrorBySlug',
    args: [slug],
  });
}

export async function mirrorExists(slug: string): Promise<boolean> {
  const { keccak256, toBytes } = await import('viem');
  const slugHash = keccak256(toBytes(slug));
  return (await a2aPublicClient.readContract({
    address: A2A_CONTRACTS.MarketMirrorRegistry as Address,
    abi: MARKET_MIRROR_REGISTRY_ABI,
    functionName: 'mirrorExists',
    args: [slugHash],
  })) as boolean;
}

export async function getAllMirrors(): Promise<readonly `0x${string}`[]> {
  return (await a2aPublicClient.readContract({
    address: A2A_CONTRACTS.MarketMirrorRegistry as Address,
    abi: MARKET_MIRROR_REGISTRY_ABI,
    functionName: 'getAllSlugs',
  })) as readonly `0x${string}`[];
}
