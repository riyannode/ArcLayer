/**
 * Pre-defined protection notices — ready to fire via useProtectionNotice().notify().
 * Import the one you need and spread into notify().
 */

import type { ProtectionInput } from "./types";

export const NOTICE_REPLAY_REJECTED: ProtectionInput = {
  surface: "modal",
  severity: "protection",
  title: "Receipt already used protection",
  subtitle: "Duplicate payment rejected",
  message: "This payment receipt was already consumed and cannot unlock the protected resource again.",
  technicalDetail: "Replay rejected: gateway_payment_replayed",
  autoCloseMs: 5_000,
  dedupeKey: "x402:replay_rejected",
};

export const NOTICE_REPLAY_FAILED: ProtectionInput = {
  surface: "modal",
  severity: "error",
  title: "Replay protection failed",
  subtitle: "Duplicate payment was accepted unexpectedly",
  message: "The same payment receipt unlocked the resource twice. This must be fixed.",
  autoCloseMs: 0, // stays until dismissed
  dedupeKey: "x402:replay_failed",
};

export const NOTICE_PAYMENT_REQUIRED: ProtectionInput = {
  surface: "modal",
  severity: "warning",
  title: "Payment required",
  subtitle: "This resource is protected by x402",
  message: "Complete payment before accessing this agent run or protected resource.",
  technicalDetail: "HTTP 402 Payment Required",
  autoCloseMs: 5_000,
  dedupeKey: "x402:payment_required",
};

export const NOTICE_PAYMENT_REQUIRED_INLINE: ProtectionInput = {
  surface: "inline",
  severity: "warning",
  title: "Payment required",
  message: "Complete payment before accessing this protected resource.",
  technicalDetail: "HTTP 402 Payment Required",
  dedupeKey: "x402:payment_required_inline",
};

export const NOTICE_WALLET_NOT_CONNECTED: ProtectionInput = {
  surface: "inline",
  severity: "warning",
  title: "Connect wallet",
  message: "Connect your wallet to execute this action.",
  dedupeKey: "wallet:not_connected",
};

export const NOTICE_WRONG_CHAIN: ProtectionInput = {
  surface: "toast",
  severity: "warning",
  title: "Wrong network",
  message: "Switch to Arc Testnet to continue.",
  technicalDetail: "Expected chain id: 5042002",
  autoCloseMs: 5_000,
  dedupeKey: "chain:wrong",
};

export const NOTICE_INSUFFICIENT_USDC: ProtectionInput = {
  surface: "toast",
  severity: "error",
  title: "Insufficient USDC",
  message: "Your wallet does not have enough Arc Testnet USDC for this payment.",
  autoCloseMs: 5_000,
  dedupeKey: "balance:insufficient_usdc",
};

export const NOTICE_WORKER_EQUALS_CLIENT: ProtectionInput = {
  surface: "inline",
  severity: "error",
  title: "Invalid job role",
  message: "Worker and client cannot be the same wallet. Choose a different worker wallet.",
  technicalDetail: "JobEscrow revert: Worker is client",
  dedupeKey: "jobs:worker_is_client",
};

export const NOTICE_UNAUTHORIZED_EVALUATOR: ProtectionInput = {
  surface: "modal",
  severity: "error",
  title: "Evaluator required",
  subtitle: "Unauthorized settlement attempt",
  message: "Only the assigned evaluator can approve this job.",
  autoCloseMs: 0,
  dedupeKey: "jobs:unauthorized_evaluator",
};

export const NOTICE_PAYMENT_VERIFIED: ProtectionInput = {
  surface: "toast",
  severity: "success",
  title: "Payment verified",
  message: "Payment signature validated successfully.",
  autoCloseMs: 3_500,
  dedupeKey: "x402:verified",
};

export const NOTICE_PAYMENT_SETTLED: ProtectionInput = {
  surface: "toast",
  severity: "success",
  title: "Payment settled",
  message: "On-chain settlement confirmed.",
  autoCloseMs: 3_500,
  dedupeKey: "x402:settled",
};

export const NOTICE_RESOURCE_UNLOCKED: ProtectionInput = {
  surface: "toast",
  severity: "success",
  title: "Resource unlocked",
  message: "Protected resource access granted.",
  autoCloseMs: 3_500,
  dedupeKey: "x402:unlocked",
};

export const NOTICE_TX_PENDING: ProtectionInput = {
  surface: "toast",
  severity: "info",
  title: "Transaction pending",
  message: "Waiting for on-chain confirmation…",
  autoCloseMs: 0,
  dedupeKey: "tx:pending",
};

export const NOTICE_TX_FAILED: ProtectionInput = {
  surface: "toast",
  severity: "error",
  title: "Transaction failed",
  message: "The transaction reverted on-chain. Check gas and parameters.",
  autoCloseMs: 5_000,
  dedupeKey: "tx:failed",
};
