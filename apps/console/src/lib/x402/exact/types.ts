/**
 * Canonical x402 V2 types for the `exact` scheme on EVM (EIP-3009).
 *
 * Source of truth: github.com/x402-foundation/x402 — packages/core/src/types
 * Reference: docs/schemes/exact.mdx, e2e/facilitators/text-facilitator-protocol.txt
 */

export type Network = `${string}:${string}`; // CAIP-2: e.g. "eip155:5042002"

export interface ExactEvmAuthorization {
  /** Signer / token holder paying. EIP-55 checksummed. */
  from: `0x${string}`;
  /** Recipient. Must equal paymentRequirements.payTo. */
  to: `0x${string}`;
  /** Atomic units (string for BigInt safety). Must equal paymentRequirements.amount. */
  value: string;
  /** Unix seconds. Authorization invalid before this. "0" = always valid. */
  validAfter: string;
  /** Unix seconds. Authorization invalid after this. */
  validBefore: string;
  /** bytes32 hex random nonce, scoped to the `from` account on the token. */
  nonce: `0x${string}`;
}

export interface ExactEvmPayload {
  /** EIP-712 signature of TransferWithAuthorization typed data. 65-byte r||s||v hex. */
  signature: `0x${string}`;
  authorization: ExactEvmAuthorization;
}

/** Canonical x402 PaymentRequirements. */
export interface PaymentRequirements {
  scheme: 'exact';
  network: Network;
  /** ERC-20 asset contract address. */
  asset: `0x${string}`;
  /** Atomic units, string. */
  amount: string;
  payTo: `0x${string}`;
  /** Seconds the requirement can sit in the buyer's queue. */
  maxTimeoutSeconds: number;
  /** EIP-712 domain hints + display info. */
  extra: {
    name?: string;
    version?: string;
    decimals?: number;
    symbol?: string;
    [k: string]: unknown;
  };
}

/** Canonical x402 PaymentPayload (V2). */
export interface PaymentPayload {
  x402Version: 2;
  /** Server-provided requirement the buyer accepted (echoed). */
  accepted: PaymentRequirements;
  /** Scheme-specific. For `exact` on EVM: ExactEvmPayload. */
  payload: ExactEvmPayload;
  /** Optional resource info (URL, MIME type). */
  resource?: {
    url?: string;
    mimeType?: string;
    [k: string]: unknown;
  };
  extensions?: Record<string, unknown>;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: `0x${string}`;
  paymentIdentifier?: string;
  extra?: Record<string, unknown>;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: `0x${string}`;
  /** On-chain tx hash. Empty on failure. */
  transaction: string;
  network: Network;
  amount?: string;
  paymentIdentifier?: string;
  alreadySettled?: boolean;
}

export interface SupportedKind {
  x402Version: number;
  scheme: string;
  network: Network;
  extra?: Record<string, unknown>;
}

/** Canonical invalid_reason enum. */
export type InvalidReason =
  | 'invalid_json'
  | 'missing_parameters'
  | 'unsupported_version'
  | 'unsupported_scheme'
  | 'unsupported_network'
  | 'unsupported_asset'
  | 'invalid_payment_payload'
  | 'invalid_payment_requirements'
  | 'invalid_signature'
  | 'invalid_amount'
  | 'invalid_recipient'
  | 'invalid_resource'
  | 'expired'
  | 'not_yet_valid'
  | 'nonce_used'
  | 'insufficient_balance'
  | 'insufficient_allowance'
  | 'chain_unavailable'
  | 'unexpected_error';

/** Canonical settle error_reason enum. */
export type SettleErrorReason =
  | 'not_verified'
  | 'verification_expired'
  | 'authorization_expired'
  | 'authorization_used'
  | 'insufficient_balance'
  | 'insufficient_allowance'
  | 'rpc_failure'
  | 'relayer_unfunded'
  | 'relayer_not_configured'
  | 'tx_reverted'
  | 'tx_dropped'
  | 'duplicate'
  | 'rate_limited'
  | 'circuit_open'
  | 'unexpected_error';
