/**
 * Rail type identifiers for ArcLayer dual-rail architecture.
 *
 * Every API response must include both `rail` and `settlementMode` so
 * callers know which rail owns the response.
 *
 * Rails:
 * - bridge:     x402 external agent bridge (session-based, cross-process)
 * - offchain_job: legacy x402 off-chain agent job
 * - escrow:     ERC-8183 on-chain escrow job
 */
export type RailType = 'bridge' | 'offchain_job' | 'escrow';

export type SettlementMode = 'x402_offchain' | 'erc8183_escrow';

export const RAIL: Record<RailType, { rail: RailType; settlementMode: SettlementMode }> = {
  bridge: { rail: 'bridge', settlementMode: 'x402_offchain' },
  offchain_job: { rail: 'offchain_job', settlementMode: 'x402_offchain' },
  escrow: { rail: 'escrow', settlementMode: 'erc8183_escrow' },
};
