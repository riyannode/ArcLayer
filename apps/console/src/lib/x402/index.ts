/**
 * x402 Dual-Payment Library — public surface.
 *
 * Two payment rails only:
 *   1. Arc Native (EIP-3009 transferWithAuthorization, self-hosted relayer)
 *   2. Circle Gateway (batched EIP-3009 via Circle facilitator)
 *
 * Legacy `arc-escrow` scheme has been removed.
 */

export * from './types';
export * from './constants';
export * from './exact/types';
export {
  parseExactVerifyRequest,
  verifyExactEvmPayment,
  exactEip3009Abi,
} from './exact/verify-exact';
export { settleExactPayment } from './exact/settle-exact';
export {
  verifyExactSettlementProof,
  type SettlementProofResult,
} from './exact/verify-settlement-proof';
export {
  backfillNativeSettled,
  claimNativePayment,
  consumeNativePayment,
  deriveNativePaymentId,
  getNativePayment,
  markNativeFailed,
  markNativeSettled,
  type ClaimNativePaymentResult,
  type NativePaymentEvidence,
  type NativePaymentIdentity,
  type NativePaymentStatus,
} from './exact/native-payment-store';
export {
  getArcTestnetGatewayConfig,
  getBatchFacilitatorClient,
  gatewayFacilitatorUrl,
  isBatchPayment,
  isGatewayEnabled,
  probeGatewayRuntimeSupport,
} from './gateway/batch-client';
export {
  claimGatewaySettlement,
  consumeGatewayPayment,
  deriveGatewayPaymentId,
  gatewayEvidenceSummary,
  getGatewayPayment,
  recordGatewayPayment,
  type GatewayPaymentEvidence,
} from './gateway/payment-store';
export { supabaseAdmin } from './supabaseClient';
export {
  createArcNativeReceipt,
  createGatewayReceipt,
  type X402PaymentReceipt,
  type X402PaymentProvider,
  type X402ReceiptStatus,
} from './receipt';
export {
  withX402,
  withGateway,
  withNative,
  type X402MiddlewareOptions,
} from './middleware';
