/**
 * MCP Policy — Pre-approval policy checks for MCP tx actions.
 *
 * Policy v1: Only ERC-8004 identity.register on Arc Testnet.
 * Runs inside createApproval() — callers cannot bypass policy.
 *
 * Empty permissions = deny all (same as sessionHasPermission).
 */

import { getAddress, isAddress } from 'viem';
import type { McpSession } from '@/lib/agent-accounts/types';
import { sessionHasPermission } from '@/lib/mcp/sessions';

// ── Constants ─────────────────────────────────────────────────────────────

const ARC_CHAIN_ID = 5042002;
const ZERO_VALUE = '0x0';

/**
 * Map symbolic contract names to actual on-chain addresses.
 * Source of truth: sdk/src/addresses.ts
 */
const CONTRACT_MAP: Record<string, string> = {
  ERC8004_IDENTITY_REGISTRY: getAddress('0x8004A818BFB912233c491871b3d84c89A494BD9e'),
};

/** Allowed contracts for policy v1. */
const ALLOWED_CONTRACTS_V1 = new Set(Object.keys(CONTRACT_MAP));

/** Allowed actions for policy v1. */
const ALLOWED_ACTIONS_V1 = new Set([
  'identity.register',
]);

/**
 * Function selectors for allowed actions.
 * selector = keccak256("register(string)").slice(0, 10)
 * Verified via: cast sig "register(string)"
 */
const ACTION_SELECTORS: Record<string, string> = {
  'identity.register': '0x46d7c549',
};

// ── Types ─────────────────────────────────────────────────────────────────

export interface PolicyCheckInput {
  session: McpSession;
  chainId: number;
  toAddress: string;
  action: string;
  /** Raw calldata (0x-prefixed). Must match expected function selector. */
  data: string;
  value: string;
  /** Contract identifier (e.g. 'ERC8004_IDENTITY_REGISTRY'). */
  contract: string;
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
}

// ── Policy check ──────────────────────────────────────────────────────────

/**
 * Run policy v1 checks.
 * Returns { allowed: true } if all checks pass, or { allowed: false, reason } if any fail.
 */
export function checkPolicyV1(input: PolicyCheckInput): PolicyCheckResult {
  const { session, chainId, toAddress, action, data, value, contract } = input;

  // 1. Session must not be expired/revoked
  if (session.status !== 'active') {
    return { allowed: false, reason: `session_${session.status}` };
  }

  // 2. chainId must be Arc Testnet
  if (chainId !== ARC_CHAIN_ID) {
    return { allowed: false, reason: `wrong_chain:${chainId}` };
  }

  // 3. Contract must be in allowed set
  if (!ALLOWED_CONTRACTS_V1.has(contract)) {
    return { allowed: false, reason: `contract_not_allowed:${contract}` };
  }

  // 4. toAddress must match the expected contract address
  const expectedAddress = CONTRACT_MAP[contract];
  if (!expectedAddress) {
    return { allowed: false, reason: `no_address_mapping:${contract}` };
  }
  let normalizedTo: string;
  try {
    normalizedTo = getAddress(toAddress);
  } catch {
    return { allowed: false, reason: `invalid_to_address:${toAddress}` };
  }
  if (normalizedTo.toLowerCase() !== expectedAddress.toLowerCase()) {
    return { allowed: false, reason: `wrong_contract_address:${normalizedTo}` };
  }

  // 5. Action must be in allowed set
  if (!ALLOWED_ACTIONS_V1.has(action)) {
    return { allowed: false, reason: `action_not_allowed:${action}` };
  }

  // 6. Calldata must match expected function selector
  const expectedSelector = ACTION_SELECTORS[action];
  if (!expectedSelector) {
    return { allowed: false, reason: `no_selector_mapping:${action}` };
  }
  if (!data || !data.startsWith('0x') || data.length < 10) {
    return { allowed: false, reason: 'invalid_calldata' };
  }
  const actualSelector = data.slice(0, 10).toLowerCase();
  if (actualSelector !== expectedSelector.toLowerCase()) {
    return { allowed: false, reason: `wrong_selector:${actualSelector}_expected:${expectedSelector}` };
  }

  // 7. Value must be 0 (no ETH/USDC transfers for identity.register)
  if (value !== ZERO_VALUE) {
    return { allowed: false, reason: `nonzero_value:${value}` };
  }

  // 8. Session permissions must allow contract + action (empty = deny all)
  if (!sessionHasPermission(session, contract, action)) {
    return { allowed: false, reason: 'permission_denied' };
  }

  return { allowed: true };
}

/**
 * Snapshot the policy decision for audit trail.
 * Stored in policy_snapshot_json on the approval row.
 */
export function snapshotPolicy(input: PolicyCheckInput, result: PolicyCheckResult): Record<string, unknown> {
  return {
    version: 'v1',
    chainId: input.chainId,
    contract: input.contract,
    expectedAddress: CONTRACT_MAP[input.contract] ?? null,
    toAddress: input.toAddress,
    action: input.action,
    selector: input.data?.slice(0, 10) ?? null,
    value: input.value,
    sessionStatus: input.session.status,
    sessionPermissions: input.session.permissions,
    allowed: result.allowed,
    reason: result.reason ?? null,
    checkedAt: new Date().toISOString(),
  };
}
