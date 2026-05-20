/**
 * agent-wallet.ts — ArcLayer autonomous agent wallet executor.
 *
 * INTERNAL USE ONLY — Hermes on-chain executor.
 *
 * This module is strictly server-side. It MUST NOT be imported from client
 * components or API routes that expose it publicly.
 *
 * Security model:
 *   - Only Hermes (AGENT_EXECUTOR_ROLE=hermes) can sign on-chain transactions.
 *   - Pythia/Apollo are reasoning-only agents. They may sign x402 payments
 *     via a separate surface, but MUST NOT use this executor for on-chain tx.
 *   - All transactions are allowlisted by contract + function selector.
 *   - USDC.approve is additionally decoded: spender must be JOB_ESCROW,
 *     amount must be <= AGENT_EXECUTOR_MAX_USDC_ATOMIC.
 *   - Max spend guard applies to approveUsdc, fundJob, and any decoded
 *     amount in raw executeCalldata.
 *   - Arc Testnet only (chainId 5042002). Native value transfers blocked.
 *   - If AGENT_EXECUTOR_PRIVATE_KEY is missing → dryRun only, no signing.
 *
 * Chain: Arc Testnet (5042002). RPC: https://rpc.drpc.testnet.arc.network
 */

import 'server-only';

import {
  createWalletClient,
  createPublicClient,
  http,
  type Hex,
  type Address,
  type Hash,
  type TransactionReceipt,
  type WalletClient,
  type PublicClient,
  parseUnits,
  formatUnits,
  decodeAbiParameters,
} from 'viem';
import { arcTestnet, ARC_RPC_URLS } from '@arclayer/sdk';

// ────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────

const RPC_URL = process.env.ARC_RPC_URL || ARC_RPC_URLS[0];
const CHAIN_ID = arcTestnet.id;
const USDC = '0x3600000000000000000000000000000000000000' as const;
const JOB_ESCROW = '0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225' as const;

// USDC ERC-20 decimals — used for transfer/approve/escrow operations.
// Native gas interface uses 18 decimals (see getEthBalance below). Do not mix.
const USDC_DECIMALS = 6;
const MAX_GAS_PER_TX = BigInt(500_000);

/**
 * Per-tx max USDC notional, atomic units (USDC has 6 decimals → 1 USDC = 1e6).
 * Defaults to 100 USDC per tx if env not set. Set to "0" to disable signing.
 */
function getMaxUsdcAtomic(): bigint {
  const raw = process.env.AGENT_EXECUTOR_MAX_USDC_ATOMIC;
  if (!raw) return BigInt(100_000_000); // 100 USDC default
  try {
    const n = BigInt(raw);
    if (n < BigInt(0)) throw new Error('negative');
    return n;
  } catch {
    throw new Error(`AGENT_EXECUTOR_MAX_USDC_ATOMIC must be a non-negative integer, got: ${raw}`);
  }
}

function getPrivateKey(): Hex {
  const key = process.env.AGENT_EXECUTOR_PRIVATE_KEY;
  if (!key) throw new Error('AGENT_EXECUTOR_PRIVATE_KEY not set in environment');
  const hex = key.startsWith('0x') ? key : `0x${key}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hex)) {
    throw new Error('AGENT_EXECUTOR_PRIVATE_KEY must be a 64-char hex string');
  }
  return hex as Hex;
}

function getAgentAddress(): Address {
  const pk = getPrivateKey();
  // derive address from private key using viem internals
  const { privateKeyToAccount } = require('viem/accounts') as typeof import('viem/accounts');
  return privateKeyToAccount(pk).address;
}

// ────────────────────────────────────────────────────────
// Clients (lazy, cache after first call)
// ────────────────────────────────────────────────────────

let _wallet: WalletClient | null = null;
let _public: PublicClient | null = null;
let _agentAddress: Address | null = null;

function wallet(): WalletClient {
  if (!_wallet) {
    const pk = getPrivateKey();
    const { privateKeyToAccount } = require('viem/accounts') as typeof import('viem/accounts');
    _wallet = createWalletClient({
      account: privateKeyToAccount(pk),
      chain: arcTestnet,
      transport: http(RPC_URL),
    });
  }
  return _wallet;
}

function publicClient(): PublicClient {
  if (!_public) {
    _public = createPublicClient({
      chain: arcTestnet,
      transport: http(RPC_URL),
    });
  }
  return _public;
}

function agentAddress(): Address {
  if (!_agentAddress) _agentAddress = getAgentAddress();
  return _agentAddress;
}

// ────────────────────────────────────────────────────────
// Read helpers
// ────────────────────────────────────────────────────────

export async function getUsdcBalance(address?: Address): Promise<{ atomic: bigint; formatted: string }> {
  const addr = address || agentAddress();
  const pc = publicClient();
  const balance = await pc.readContract({
    address: USDC as Address,
    abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
    functionName: 'balanceOf',
    args: [addr],
  }) as bigint;
  return { atomic: balance, formatted: formatUnits(balance, USDC_DECIMALS) };
}

export async function getUsdcAllowance(owner?: Address, spender?: Address): Promise<{ atomic: bigint; formatted: string }> {
  const ownerAddr = owner || agentAddress();
  const spenderAddr = spender || (JOB_ESCROW as Address);
  const pc = publicClient();
  const allowance = await pc.readContract({
    address: USDC as Address,
    abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
    functionName: 'allowance',
    args: [ownerAddr, spenderAddr],
  }) as bigint;
  return { atomic: allowance, formatted: formatUnits(allowance, USDC_DECIMALS) };
}

/**
 * Native gas balance on Arc.
 *
 * Arc native gas token is USDC, but the NATIVE interface uses 18 decimals
 * (not 6 like the ERC-20 contract). This is intentional per Arc spec.
 */
export async function getEthBalance(address?: Address): Promise<{ atomic: bigint; formatted: string }> {
  const addr = address || agentAddress();
  const pc = publicClient();
  const balance = await pc.getBalance({ address: addr });
  return { atomic: balance, formatted: formatUnits(balance, 18) };
}

// ────────────────────────────────────────────────────────
// Write helpers
// ────────────────────────────────────────────────────────

export interface TxResult {
  txHash: Hash | null;
  receipt: TransactionReceipt | null;
  success: boolean;
  dryRun: boolean;
  explorer: string | null;
  reason?: string;
}

type AllowedSelector =
  | 'USDC.approve'
  | 'JobEscrow.setBudget'
  | 'JobEscrow.fund'
  | 'JobEscrow.submitDeliverable'
  | 'JobEscrow.evaluate'
  | 'JobEscrow.settle'
  | 'JobEscrow.refundRejected'
  | 'JobEscrow.cancelJob';

const ALLOWED_SELECTORS: Record<AllowedSelector, { to: Address; selector: Hex }> = {
  'USDC.approve': { to: USDC as Address, selector: '0x095ea7b3' },
  'JobEscrow.setBudget': { to: JOB_ESCROW as Address, selector: '0x9675dc17' },
  'JobEscrow.fund': { to: JOB_ESCROW as Address, selector: '0xa65e2cfd' },
  'JobEscrow.submitDeliverable': { to: JOB_ESCROW as Address, selector: '0x54460e7f' },
  'JobEscrow.evaluate': { to: JOB_ESCROW as Address, selector: '0x7084dc90' },
  'JobEscrow.settle': { to: JOB_ESCROW as Address, selector: '0x8df82800' },
  'JobEscrow.refundRejected': { to: JOB_ESCROW as Address, selector: '0x19de89ea' },
  'JobEscrow.cancelJob': { to: JOB_ESCROW as Address, selector: '0x1dffa3dc' },
};

function assertHermesExecutor() {
  const role = (process.env.AGENT_EXECUTOR_ROLE || '').toLowerCase();
  if (role !== 'hermes') {
    throw new Error('agent-wallet is internal-only: set AGENT_EXECUTOR_ROLE=hermes to enable signing');
  }
}

function assertMaxUsdcAmount(amountAtomic: bigint, context: string) {
  const max = getMaxUsdcAtomic();
  if (amountAtomic > max) {
    throw new Error(`${context} amount ${amountAtomic.toString()} exceeds AGENT_EXECUTOR_MAX_USDC_ATOMIC=${max.toString()}`);
  }
}

function assertAllowedTx(to: Address, data: Hex, value: bigint) {
  if (CHAIN_ID !== 5042002) throw new Error('agent-wallet only supports Arc Testnet chainId=5042002');
  if (value !== BigInt(0)) throw new Error('native value transfers are not allowed');

  const selector = data.slice(0, 10).toLowerCase() as Hex;
  const allowed = Object.entries(ALLOWED_SELECTORS).find(
    ([, rule]) => rule.to.toLowerCase() === to.toLowerCase() && rule.selector.toLowerCase() === selector,
  );
  if (!allowed) throw new Error(`tx not allowlisted: to=${to} selector=${selector}`);

  const [, allowedName] = allowed;
  const encodedArgs = `0x${data.slice(10)}` as Hex;

  if (allowedName.to.toLowerCase() === USDC.toLowerCase() && selector === ALLOWED_SELECTORS['USDC.approve'].selector) {
    const [spender, amount] = decodeAbiParameters(
      [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
      encodedArgs,
    ) as readonly [Address, bigint];

    if (spender.toLowerCase() !== JOB_ESCROW.toLowerCase()) {
      throw new Error(`USDC.approve spender not allowed: ${spender}`);
    }
    assertMaxUsdcAmount(amount, 'USDC.approve');
    return;
  }

  if (selector === ALLOWED_SELECTORS['JobEscrow.setBudget'].selector) {
    const [, budget] = decodeAbiParameters(
      [{ name: 'jobId', type: 'uint256' }, { name: 'budget', type: 'uint256' }],
      encodedArgs,
    ) as readonly [bigint, bigint];
    assertMaxUsdcAmount(budget, 'JobEscrow.setBudget');
    return;
  }

  if (selector === ALLOWED_SELECTORS['JobEscrow.fund'].selector) {
    const [, amount] = decodeAbiParameters(
      [{ name: 'jobId', type: 'uint256' }, { name: 'amount', type: 'uint256' }],
      encodedArgs,
    ) as readonly [bigint, bigint];
    assertMaxUsdcAmount(amount, 'JobEscrow.fund');
  }
}

function dryRunResult(to: Address, data: Hex, reason: string): TxResult {
  console.warn(`[agent-wallet] dryRun: ${reason} to=${to} selector=${data.slice(0, 10)}`);
  return { txHash: null, receipt: null, success: true, dryRun: true, explorer: null, reason };
}

async function sendAndWait(to: Address, data: Hex, value = BigInt(0), gas?: bigint): Promise<TxResult> {
  assertAllowedTx(to, data, value);

  if (!process.env.AGENT_EXECUTOR_PRIVATE_KEY) {
    return dryRunResult(to, data, 'AGENT_EXECUTOR_PRIVATE_KEY missing');
  }
  assertHermesExecutor();

  const w = wallet();
  const addr = agentAddress();

  console.log(`[agent-wallet] signer=${addr} to=${to} data=${data.slice(0, 34)}...`);

  const txHash = await w.sendTransaction({
    account: w.account!,
    chain: arcTestnet,
    to,
    data,
    value,
    gas: gas || MAX_GAS_PER_TX,
  });

  console.log(`[agent-wallet] tx sent: ${txHash}`);

  const pc = publicClient();
  const receipt = await pc.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });

  if (receipt.status !== 'success') {
    console.error(`[agent-wallet] tx reverted: ${txHash} block=${receipt.blockNumber}`);
    return {
      txHash,
      receipt,
      success: false,
      dryRun: false,
      explorer: `https://testnet.arcscan.app/tx/${txHash}`,
    };
  }

  console.log(`[agent-wallet] tx confirmed: ${txHash} block=${receipt.blockNumber} gasUsed=${receipt.gasUsed}`);
  return {
    txHash,
    receipt,
    success: true,
    dryRun: false,
    explorer: `https://testnet.arcscan.app/tx/${txHash}`,
  };
}

// ────────────────────────────────────────────────────────
// High-level job lifecycle actions
// ────────────────────────────────────────────────────────

/**
 * Approve USDC spender (JobEscrow) for the given amount.
 * Must be called before fundJob.
 */
export async function approveUsdc(amountUsdc: string): Promise<TxResult> {
  const amount = parseUnits(amountUsdc, USDC_DECIMALS);
  assertMaxUsdcAmount(amount, 'approveUsdc');
  const { encodeFunctionData } = await import('viem');

  const data = encodeFunctionData({
    abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }],
    functionName: 'approve',
    args: [JOB_ESCROW as Address, amount],
  });

  console.log(`[agent-wallet] approve USDC: ${amountUsdc} to ${JOB_ESCROW}`);
  return sendAndWait(USDC as Address, data);
}

/**
 * Fund a job in escrow with USDC.
 * Requires: USDC.approve(JobEscrow, amount) called first.
 */
export async function fundJob(jobId: bigint | string, amountUsdc: string): Promise<TxResult> {
  const jobIdBn = typeof jobId === 'string' ? BigInt(jobId) : jobId;
  const amount = parseUnits(amountUsdc, USDC_DECIMALS);
  assertMaxUsdcAmount(amount, 'fundJob');
  const { encodeFunctionData } = await import('viem');

  const data = encodeFunctionData({
    abi: [{ name: 'fund', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'amount', type: 'uint256' }], outputs: [] }],
    functionName: 'fund',
    args: [jobIdBn, amount],
  });

  console.log(`[agent-wallet] fund job ${jobIdBn.toString()}: ${amountUsdc} USDC`);
  return sendAndWait(JOB_ESCROW as Address, data);
}

/**
 * Submit a deliverable for a job.
 * Called by the worker (agent) after LLM completes the task.
 */
export async function submitDeliverable(
  jobId: bigint | string,
  deliverableURI: string,
  proofMetadataURI: string,
): Promise<TxResult> {
  const jobIdBn = typeof jobId === 'string' ? BigInt(jobId) : jobId;
  const { encodeFunctionData } = await import('viem');

  const data = encodeFunctionData({
    abi: [{ name: 'submitDeliverable', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'deliverableURI', type: 'string' }, { name: 'proofMetadataURI', type: 'string' }], outputs: [] }],
    functionName: 'submitDeliverable',
    args: [jobIdBn, deliverableURI, proofMetadataURI],
  });

  console.log(`[agent-wallet] submit deliverable job=${jobIdBn.toString()}`);
  return sendAndWait(JOB_ESCROW as Address, data);
}

/**
 * Evaluate a job (approve or reject the deliverable).
 * Called by the evaluator.
 */
export async function evaluateJob(jobId: bigint | string, approved: boolean): Promise<TxResult> {
  const jobIdBn = typeof jobId === 'string' ? BigInt(jobId) : jobId;
  const { encodeFunctionData } = await import('viem');

  const data = encodeFunctionData({
    abi: [{ name: 'evaluate', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'approved', type: 'bool' }], outputs: [] }],
    functionName: 'evaluate',
    args: [jobIdBn, approved],
  });

  console.log(`[agent-wallet] evaluate job=${jobIdBn.toString()} approved=${approved}`);
  return sendAndWait(JOB_ESCROW as Address, data);
}

/**
 * Settle a job after evaluation.
 * Sends USDC to worker + fee to protocol, mints WorkProof NFT.
 * Can be called by anyone.
 */
export async function settleJob(jobId: bigint | string): Promise<TxResult> {
  const jobIdBn = typeof jobId === 'string' ? BigInt(jobId) : jobId;
  const { encodeFunctionData } = await import('viem');

  const data = encodeFunctionData({
    abi: [{ name: 'settle', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] }],
    functionName: 'settle',
    args: [jobIdBn],
  });

  console.log(`[agent-wallet] settle job=${jobIdBn.toString()}`);
  return sendAndWait(JOB_ESCROW as Address, data, BigInt(0), BigInt(500_000));
}

/**
 * Refund a rejected job after evaluator called evaluate(jobId, false).
 * Sends funded USDC back to the client.
 */
export async function refundRejectedJob(jobId: bigint | string): Promise<TxResult> {
  const jobIdBn = typeof jobId === 'string' ? BigInt(jobId) : jobId;
  const { encodeFunctionData } = await import('viem');

  const data = encodeFunctionData({
    abi: [{ name: 'refundRejected', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] }],
    functionName: 'refundRejected',
    args: [jobIdBn],
  });

  console.log(`[agent-wallet] refund rejected job=${jobIdBn.toString()}`);
  return sendAndWait(JOB_ESCROW as Address, data, BigInt(0), BigInt(200_000));
}

/**
 * Cancel an unfunded job while it is Created or Budgeted.
 */
export async function cancelJob(jobId: bigint | string): Promise<TxResult> {
  const jobIdBn = typeof jobId === 'string' ? BigInt(jobId) : jobId;
  const { encodeFunctionData } = await import('viem');

  const data = encodeFunctionData({
    abi: [{ name: 'cancelJob', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] }],
    functionName: 'cancelJob',
    args: [jobIdBn],
  });

  console.log(`[agent-wallet] cancel job=${jobIdBn.toString()}`);
  return sendAndWait(JOB_ESCROW as Address, data, BigInt(0), BigInt(120_000));
}

/**
 * Execute allowlisted calldata only. Internal Hermes executor surface — not a public signer.
 */
export async function executeCalldata(
  to: Address,
  data: Hex,
  value?: string,
  gas?: string,
): Promise<TxResult> {
  const valueBn = value ? BigInt(value) : BigInt(0);
  const gasBn = gas ? BigInt(gas) : MAX_GAS_PER_TX;

  console.log(`[agent-wallet] execute calldata to=${to}`);
  return sendAndWait(to, data, valueBn, gasBn);
}

/**
 * Convenience: full lifecycle — approve + fund job in one call.
 */
export async function approveAndFund(
  jobId: bigint | string,
  amountUsdc: string,
): Promise<{ approve: TxResult; fund: TxResult }> {
  console.log(`[agent-wallet] approve + fund cycle for job=${jobId.toString()} amount=${amountUsdc} USDC`);

  const approve = await approveUsdc(amountUsdc);
  if (!approve.success) throw new Error(`approve failed: ${approve.txHash}`);

  const fund = await fundJob(jobId, amountUsdc);
  if (!fund.success) throw new Error(`fund failed: ${fund.txHash}`);

  return { approve, fund };
}

// ────────────────────────────────────────────────────────
// Health check
// ────────────────────────────────────────────────────────

export interface AgentWalletHealth {
  ready: boolean;
  address: Address;
  ethBalance: string;
  usdcBalance: string;
  usdcAllowance: string;
  rpc: string;
}

export async function healthCheck(): Promise<AgentWalletHealth> {
  try {
    const addr = agentAddress();
    const [eth, usdc, allowance] = await Promise.all([
      getEthBalance(addr),
      getUsdcBalance(addr),
      getUsdcAllowance(addr, JOB_ESCROW as Address),
    ]);
    return {
      ready: true,
      address: addr,
      ethBalance: eth.formatted,
      usdcBalance: usdc.formatted,
      usdcAllowance: allowance.formatted,
      rpc: RPC_URL,
    };
  } catch (err) {
    return {
      ready: false,
      address: '0x0',
      ethBalance: '0',
      usdcBalance: '0',
      usdcAllowance: '0',
      rpc: RPC_URL,
    };
  }
}

// Safe constants for internal executor telemetry only. Do not export signer/client primitives.
export { agentAddress, USDC, JOB_ESCROW, CHAIN_ID, RPC_URL };
