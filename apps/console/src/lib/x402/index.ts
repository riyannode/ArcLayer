/**
 * x402 Payment Library — Circle Gateway only (public surface).
 *
 * Arc Native x402 runtime has been removed.
 * Circle Gateway (batched EIP-3009 via Circle facilitator) is the only active rail.
 *
 */

export * from './types';
export * from './constants';
export * from './exact/types';
export {
  parseExactVerifyRequest,
  exactEip3009Abi,
} from './exact/verify-exact';
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
  createGatewayReceipt,
  type X402PaymentReceipt,
  type X402PaymentProvider,
  type X402ReceiptStatus,
} from './receipt';
export {
  withX402,
  withGateway,
  CIRCLE_GATEWAY_TIMEOUT_SECONDS,
  type X402MiddlewareOptions,
} from './middleware';
