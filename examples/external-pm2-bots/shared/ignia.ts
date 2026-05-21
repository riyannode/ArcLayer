import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from './x402-client.js';

export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
export const IGNIA_ADDRESS = (process.env.IGNIA_ADDRESS ?? '0xd66971F9Da4c60DB4A061686F43dBf39Db5E2916') as Address;
export const ARC_RPC_URL = process.env.ARC_RPC_URL ?? 'https://rpc.drpc.testnet.arc.network';
// ERC-20 USDC decimals (6) — for token transfers/approvals.
// Native gas interface uses 18 decimals — see Arc docs dual-decimal model.
export const USDC_DECIMALS = 6;

export enum IgniaSide {
  YES = 0,
  NO = 1,
}

export enum IgniaOutcome {
  UNRESOLVED = 0,
  YES = 1,
  NO = 2,
}

export interface IgniaMarket {
  id: bigint;
  question: string;
  yesShares: bigint;
  noShares: bigint;
  totalYesBought: bigint;
  totalNoBought: bigint;
  pool: bigint;
  outcome: IgniaOutcome;
  resolutionDeadline: bigint;
  yesProbabilityBps: number;
}

export const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', inputs: [{ type: 'address', name: 'account' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'allowance', inputs: [{ type: 'address', name: 'owner' }, { type: 'address', name: 'spender' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'approve', inputs: [{ type: 'address', name: 'spender' }, { type: 'uint256', name: 'amount' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
] as const;

export const IGNIA_ABI = [
  { type: 'function', name: 'marketCount', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'createMarket', inputs: [{ type: 'string', name: 'question' }, { type: 'uint256', name: 'deadline' }, { type: 'uint256', name: 'seedUsdc' }], outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getYesProbability', inputs: [{ type: 'uint256', name: 'marketId' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  {
    type: 'function',
    name: 'getMarket',
    inputs: [{ type: 'uint256', name: 'marketId' }],
    outputs: [
      { type: 'string', name: 'question' },
      { type: 'uint256', name: 'yesShares' },
      { type: 'uint256', name: 'noShares' },
      { type: 'uint256', name: 'totalYesBought' },
      { type: 'uint256', name: 'totalNoBought' },
      { type: 'uint256', name: 'pool' },
      { type: 'uint8', name: 'outcome' },
      { type: 'uint256', name: 'resolutionDeadline' },
    ],
    stateMutability: 'view',
  },
  { type: 'function', name: 'quoteShares', inputs: [{ type: 'uint256', name: 'marketId' }, { type: 'uint8', name: 'side' }, { type: 'uint256', name: 'usdcAmount' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'buyShares', inputs: [{ type: 'uint256', name: 'marketId' }, { type: 'uint8', name: 'side' }, { type: 'uint256', name: 'usdcAmount' }], outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'resolveMarket', inputs: [{ type: 'uint256', name: 'marketId' }, { type: 'uint8', name: 'outcome' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'yesBalances', inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'noBalances', inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});

export function createIgniaWallet(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC_URL) });
  return { account, wallet };
}

export async function getLatestMarketId(): Promise<bigint> {
  const count = await publicClient.readContract({ address: IGNIA_ADDRESS, abi: IGNIA_ABI, functionName: 'marketCount' });
  if (count === 0n) throw new Error('Ignia has no markets');
  return count - 1n;
}

export async function readMarket(marketId: bigint): Promise<IgniaMarket> {
  const [market, yesProb] = await Promise.all([
    publicClient.readContract({ address: IGNIA_ADDRESS, abi: IGNIA_ABI, functionName: 'getMarket', args: [marketId] }),
    publicClient.readContract({ address: IGNIA_ADDRESS, abi: IGNIA_ABI, functionName: 'getYesProbability', args: [marketId] }),
  ]);
  const [question, yesShares, noShares, totalYesBought, totalNoBought, pool, outcome, resolutionDeadline] = market;
  return {
    id: marketId,
    question,
    yesShares,
    noShares,
    totalYesBought,
    totalNoBought,
    pool,
    outcome: Number(outcome) as IgniaOutcome,
    resolutionDeadline,
    yesProbabilityBps: Number(yesProb) / 10_000,
  };
}

export async function ensureUsdcAllowance(privateKey: `0x${string}`, amount: bigint): Promise<Hash | null> {
  const { account, wallet } = createIgniaWallet(privateKey);
  const allowance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, IGNIA_ADDRESS],
  });
  if (allowance >= amount) return null;
  const hash = await wallet.writeContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [IGNIA_ADDRESS, amount],
    account,
    chain: arcTestnet,
  });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000, pollingInterval: 2_000 });
  return hash;
}

export async function buyIgniaShares(privateKey: `0x${string}`, marketId: bigint, side: IgniaSide, usdcAmountText: string) {
  const amount = parseUnits(usdcAmountText, USDC_DECIMALS);
  const approveTx = await ensureUsdcAllowance(privateKey, amount);
  const quotedShares = await publicClient.readContract({
    address: IGNIA_ADDRESS,
    abi: IGNIA_ABI,
    functionName: 'quoteShares',
    args: [marketId, side, amount],
  });
  const { account, wallet } = createIgniaWallet(privateKey);
  const hash = await wallet.writeContract({
    address: IGNIA_ADDRESS,
    abi: IGNIA_ABI,
    functionName: 'buyShares',
    args: [marketId, side, amount],
    account,
    chain: arcTestnet,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000, pollingInterval: 2_000 });
  return { approveTx, tradeTx: hash, receipt, quotedShares, amount };
}

export async function resolveIgniaMarket(privateKey: `0x${string}`, marketId: bigint, outcome: IgniaOutcome) {
  if (outcome === IgniaOutcome.UNRESOLVED) throw new Error('Cannot resolve to UNRESOLVED');
  const { account, wallet } = createIgniaWallet(privateKey);
  const hash = await wallet.writeContract({
    address: IGNIA_ADDRESS,
    abi: IGNIA_ABI,
    functionName: 'resolveMarket',
    args: [marketId, outcome],
    account,
    chain: arcTestnet,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000, pollingInterval: 2_000 });
  return { txHash: hash, receipt };
}

export function formatUsdc(amount: bigint): string {
  return `${formatUnits(amount, USDC_DECIMALS)} USDC`;
}
