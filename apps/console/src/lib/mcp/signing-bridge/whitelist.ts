/**
 * MCP Signing Bridge — Contract & Selector Whitelist.
 *
 * Validates every transaction in a signing request against:
 * - Allowed contract addresses (to field)
 * - Allowed function selectors (first 4 bytes of calldata)
 * - USDC approve must be exact amount, never maxUint
 *
 * Arc Testnet only. PR 1 scope.
 */

import { type Hex } from 'viem';
import { CONTRACTS, ARC_TOKENS } from '@arclayer/sdk';

// ── Constants ─────────────────────────────────────────────────────────────

const ARC_CHAIN_ID = 5042002;
const MAX_TXS_PER_REQUEST = 3;

// ── Allowed Contracts ─────────────────────────────────────────────────────

const ALLOWED_CONTRACTS = new Set<string>([
  CONTRACTS.ERC8183_AGENTIC_COMMERCE.toLowerCase(),
  ARC_TOKENS.USDC.toLowerCase(),
]);

// ── Allowed Function Selectors ────────────────────────────────────────────

/**
 * Function selectors (first 4 bytes of calldata) allowed per contract.
 * Extracted from SDK ABI via: encodeFunctionData({ abi, functionName, args: [...] }).slice(0, 10)
 *
 * ERC-8183 AgenticCommerce:
 *   createJob(address,address,uint256,string,bytes)  → 0x61b8ce8d
 *   fund(uint256,bytes)                              → 0x2428b337
 *   complete(uint256,bytes32,bytes)                   → 0x5e35a78b
 *   reject(uint256,bytes32,bytes)                     → 0x41dd26f5
 *   claimRefund(uint256)                             → 0xd6b44464
 *
 * USDC (ERC-20):
 *   approve(address,uint256)                         → 0x095ea7b3
 */

const ERC8183_SELECTORS = new Set<string>([
  '0x41528812', // createJob
  '0xdd4ae9d4', // setBudget
  '0xe25ba707', // fund
  '0xd75bbdf3', // complete
  '0x41dd26f5', // reject
  '0x5b7baf64', // claimRefund
]);

const USDC_SELECTORS = new Set<string>([
  '0x095ea7b3', // approve
]);

const SELECTORS_BY_CONTRACT = new Map<string, Set<string>>([
  [CONTRACTS.ERC8183_AGENTIC_COMMERCE.toLowerCase(), ERC8183_SELECTORS],
  [ARC_TOKENS.USDC.toLowerCase(), USDC_SELECTORS],
]);

// ── MaxUint Guard ─────────────────────────────────────────────────────────

/**
 * ERC-20 approve(address,uint256) selector.
 * We need to decode the amount (second 32-byte word) to reject maxUint.
 */
const APPROVE_SELECTOR = '0x095ea7b3';
const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

// ── Types ─────────────────────────────────────────────────────────────────

export type SigningTransaction = {
  kind: string;       // e.g. 'usdc_approve', 'erc8183_create_job', 'erc8183_fund'
  to: string;         // contract address
  data: string;       // full calldata (0x-prefixed)
  value: string;      // native value in wei (usually "0" for Arc)
  summary?: string;   // human-readable description
};

export type SigningRequestSummary = {
  actionType: string;
  description?: string;
  providerAddress?: string;
  evaluatorAddress?: string;
  jobId?: string;
  amountUsdc?: string;
  deadline?: string;
};

// ── Validation ────────────────────────────────────────────────────────────

export class WhitelistError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WhitelistError';
  }
}

/**
 * Validate a single transaction against the whitelist.
 * Throws WhitelistError on violation.
 */
function validateSingleTx(tx: SigningTransaction, index: number): void {
  const prefix = `transactions[${index}]`;

  // Must have 'to' address
  if (!tx.to || typeof tx.to !== 'string') {
    throw new WhitelistError('missing_to', `${prefix}: 'to' address is required`);
  }

  const toLower = tx.to.toLowerCase();

  // Contract must be in allowlist
  if (!ALLOWED_CONTRACTS.has(toLower)) {
    throw new WhitelistError(
      'contract_not_allowed',
      `${prefix}: contract ${tx.to} is not in the allowed whitelist`,
    );
  }

  // Must have calldata
  if (!tx.data || typeof tx.data !== 'string' || !tx.data.startsWith('0x')) {
    throw new WhitelistError('missing_data', `${prefix}: 'data' must be 0x-prefixed calldata`);
  }

  // Selector must be allowed for this contract
  const selector = tx.data.slice(0, 10).toLowerCase();
  const allowedSelectors = SELECTORS_BY_CONTRACT.get(toLower);

  if (!allowedSelectors || !allowedSelectors.has(selector)) {
    throw new WhitelistError(
      'selector_not_allowed',
      `${prefix}: selector ${selector} is not allowed for contract ${tx.to}`,
    );
  }

  // USDC approve: reject maxUint
  if (toLower === ARC_TOKENS.USDC.toLowerCase() && selector === APPROVE_SELECTOR) {
    // approve(address,uint256) — amount is second 32-byte word (bytes 34-66)
    if (tx.data.length >= 138) {
      // 0x + 8 (selector) + 64 (address padded) + 64 (amount) = 138 chars
      const amountHex = tx.data.slice(74, 138); // second 32-byte word
      const amount = BigInt(`0x${amountHex}`);
      if (amount === MAX_UINT256) {
        throw new WhitelistError(
          'max_uint_approve',
          `${prefix}: USDC approve with maxUint amount is not allowed. Use exact amount.`,
        );
      }
    }
  }

  // value must be "0" for Arc USDC-native gas (no ETH value needed)
  // Allow "0" or empty (treat as "0")
  const txValue = tx.value || '0';
  if (txValue !== '0') {
    // Non-zero value is suspicious on Arc — reject unless it's a known pattern
    // For PR 1, all ERC-8183 operations use value=0
    throw new WhitelistError(
      'non_zero_value',
      `${prefix}: non-zero value (${txValue}) is not expected for ERC-8183 operations`,
    );
  }
}

/**
 * Validate a full transactions array for a signing request.
 * Throws WhitelistError on any violation.
 */
export function validateTransactions(txs: SigningTransaction[]): void {
  if (!Array.isArray(txs) || txs.length === 0) {
    throw new WhitelistError('empty_transactions', 'transactions array must not be empty');
  }

  if (txs.length > MAX_TXS_PER_REQUEST) {
    throw new WhitelistError(
      'too_many_transactions',
      `Maximum ${MAX_TXS_PER_REQUEST} transactions per request, got ${txs.length}`,
    );
  }

  for (let i = 0; i < txs.length; i++) {
    validateSingleTx(txs[i], i);
  }
}

/**
 * Validate that the chain ID is Arc Testnet.
 */
export function validateChainId(chainId: number): void {
  if (chainId !== ARC_CHAIN_ID) {
    throw new WhitelistError(
      'wrong_chain',
      `Expected Arc Testnet (chainId ${ARC_CHAIN_ID}), got ${chainId}`,
    );
  }
}

/**
 * Get human-readable label for a known selector.
 */
export function selectorLabel(to: string, selector: string): string {
  const toLower = to.toLowerCase();

  if (toLower === ARC_TOKENS.USDC.toLowerCase()) {
    if (selector === '0x095ea7b3') return 'USDC Approve';
    return `USDC ${selector}`;
  }

  if (toLower === CONTRACTS.ERC8183_AGENTIC_COMMERCE.toLowerCase()) {
    const labels: Record<string, string> = {
      '0x41528812': 'Create Job',
      '0xdd4ae9d4': 'Set Budget',
      '0xe25ba707': 'Fund Job',
      '0xd75bbdf3': 'Complete Job',
      '0x41dd26f5': 'Reject Job',
      '0x5b7baf64': 'Claim Refund',
    };
    return labels[selector] ?? `ERC-8183 ${selector}`;
  }

  return selector;
}
