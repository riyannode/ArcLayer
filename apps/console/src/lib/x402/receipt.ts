/**
 * Unified x402 Payment Receipt
 *
 * A single type that represents a completed (or pending) payment from either
 * Arc Native (EIP-3009 self-hosted relayer) or Circle Gateway (GatewayWalletBatched).
 *
 * Used by:
 * - /api/agents/[id]/run (after verify+settle, before agent execution)
 * - /api/x402/protected-resource (after verify+settle, before resource unlock)
 * - /jobs UI (display payment confirmation)
 */

export type X402PaymentProvider = 'arc-native' | 'circle-gateway';

export type X402ReceiptStatus =
  | 'verified'
  | 'settled'
  | 'accepted_pending_settlement'
  | 'consumed'
  | 'failed';

export interface X402PaymentReceipt {
  /** Which payment rail was used. */
  provider: X402PaymentProvider;

  /** Current lifecycle status. */
  status: X402ReceiptStatus;

  /** Payer wallet address (checksummed). */
  payer: string;

  /** Receiver/seller address. */
  payTo: string;

  /** Amount in smallest unit (e.g. "1" = 0.000001 USDC with 6 decimals). */
  amount: string;

  /** Token contract address. */
  asset: string;

  /** Network identifier (CAIP-2 format: "eip155:5042002"). */
  network: string;

  /** Protected resource URL/path that was paid for. */
  resource: string;

  /**
   * Deterministic payment identifier.
   * - Arc Native: sha256(`exact:eip3009:eip155:5042002:{asset}:{from}:{nonce}`)
   * - Circle Gateway: sha256(`gateway:x402:{stableStringify({paymentPayload, paymentRequirements})}`)
   */
  paymentId: string;

  /**
   * Settlement reference.
   * - Arc Native: 0x-prefixed EVM transaction hash (linkable via Arcscan).
   * - Circle Gateway: UUID settlement ID (Circle-internal, NOT an EVM tx hash).
   */
  txHash?: string;

  /**
   * Circle Gateway settlement UUID (only present for circle-gateway provider).
   * Kept separate from txHash for clarity — this is NOT linkable on a block explorer.
   */
  gatewaySettlementId?: string;

  /** ISO timestamp when verify succeeded. */
  verifiedAt?: string;

  /** ISO timestamp when settle succeeded (or accepted_pending). */
  settledAt?: string;

  /** ISO timestamp when receipt was consumed (resource unlocked). */
  consumedAt?: string;

  /** Raw verify/settle response for developer details / debugging. */
  raw?: Record<string, unknown>;
}

/**
 * Create a receipt from Arc Native verify+settle results.
 */
export function createArcNativeReceipt(input: {
  payer: string;
  payTo: string;
  amount: string;
  asset: string;
  network: string;
  resource: string;
  paymentId: string;
  txHash: string;
  status: X402ReceiptStatus;
  verifiedAt?: string;
  settledAt?: string;
  raw?: Record<string, unknown>;
}): X402PaymentReceipt {
  return {
    provider: 'arc-native',
    status: input.status,
    payer: input.payer,
    payTo: input.payTo,
    amount: input.amount,
    asset: input.asset,
    network: input.network,
    resource: input.resource,
    paymentId: input.paymentId,
    txHash: input.txHash,
    verifiedAt: input.verifiedAt,
    settledAt: input.settledAt,
    raw: input.raw,
  };
}

/**
 * Create a receipt from Circle Gateway verify+settle results.
 */
export function createGatewayReceipt(input: {
  payer: string;
  payTo: string;
  amount: string;
  asset: string;
  network: string;
  resource: string;
  paymentId: string;
  gatewaySettlementId?: string;
  status: X402ReceiptStatus;
  verifiedAt?: string;
  settledAt?: string;
  raw?: Record<string, unknown>;
}): X402PaymentReceipt {
  return {
    provider: 'circle-gateway',
    status: input.status,
    payer: input.payer,
    payTo: input.payTo,
    amount: input.amount,
    asset: input.asset,
    network: input.network,
    resource: input.resource,
    paymentId: input.paymentId,
    txHash: input.gatewaySettlementId, // For backward compat with existing code reading txHash
    gatewaySettlementId: input.gatewaySettlementId,
    verifiedAt: input.verifiedAt,
    settledAt: input.settledAt,
    raw: input.raw,
  };
}
