import { NextResponse } from 'next/server';
import type { RailType, SettlementMode } from './types';

/**
 * Build a standard rail envelope to merge into any JSON response.
 */
export function railEnvelope(rail: RailType, settlementMode: SettlementMode) {
  return { rail, settlementMode };
}

/**
 * Rapid constructor helpers.
 */
export const bridgeRail = () => railEnvelope('bridge', 'x402_offchain');
export const offchainJobRail = () => railEnvelope('offchain_job', 'x402_offchain');
export const escrowRail = () => railEnvelope('escrow', 'erc8183_escrow');

/**
 * Return a standard wrong-rail 409 response.
 *
 * Callers should already know which rail they belong to and call
 * the correct routes. This is a safety net for legacy route leakage.
 */
export function wrongRailError(actualRail: RailType, actualSettlementMode: SettlementMode) {
  return {
    ok: false,
    rail: actualRail,
    settlementMode: actualSettlementMode,
    error: 'wrong_rail',
    message: `This is an ${actualSettlementMode} job. Use the correct API namespace for this rail.`,
  };
}

/**
 * Shorthand: erc8183 wrong-rail error (most common case for legacy route guards).
 */
export function wrongRailEscrowError() {
  return wrongRailError('escrow', 'erc8183_escrow');
}

/**
 * Send a NextResponse with rail envelope merger.
 */
export function railJson(
  body: Record<string, unknown>,
  rail: RailType,
  settlementMode: SettlementMode,
  init?: ResponseInit,
) {
  return NextResponse.json({ ...railEnvelope(rail, settlementMode), ...body }, init);
}
