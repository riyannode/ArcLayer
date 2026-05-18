/**
 * x402 Dual-Mode Types — Arc Native (EIP-3009) + Circle Gateway.
 *
 * Legacy arc-escrow types removed. Only `exact` scheme remains.
 */

export type X402Scheme = 'exact';
export type X402Network = 'eip155:5042002';

// Re-export exact types as canonical
export type {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  InvalidReason,
  SettleErrorReason,
  ExactEvmAuthorization,
  ExactEvmPayload,
  SupportedKind,
  Network,
} from './exact/types';
