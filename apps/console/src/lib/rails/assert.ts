import { wrongRailError } from './responses';
import type { RailType, SettlementMode } from './types';
import type { NextResponse } from 'next/server';

/**
 * Assert that the job's settlement_mode matches the expected rail.
 * Returns a wrong-rail error response if mismatch, or null if OK.
 */
export function assertRail(
  settlementMode: string | null | undefined,
  expected: { rail: RailType; settlementMode: SettlementMode },
): Record<string, unknown> | null {
  if (!settlementMode || settlementMode !== expected.settlementMode) {
    // Map the actual settlement_mode to a rail type for the error message
    const actualRail: RailType =
      settlementMode === 'erc8183_escrow' ? 'escrow' : 'offchain_job';
    return wrongRailError(actualRail, (settlementMode as SettlementMode) ?? 'x402_offchain');
  }
  return null;
}

/**
 * Check if a settlement_mode value matches a rail.
 */
export function isRail(
  settlementMode: string | null | undefined,
  target: SettlementMode,
): boolean {
  return settlementMode === target;
}
