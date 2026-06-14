/**
 * x402 Policy Engine — Standalone payment policy intersection.
 *
 * Role-agnostic. Used by the x402-agent role (not provider-specific).
 * The existing tool-registry already has x402 tools scoped to x402-agent role.
 *
 * Policy intersection requires ALL of:
 *   - Runner paymentEnabled
 *   - Global host allowlist
 *   - Global per-tx limit
 *   - Daily/monthly limits
 *
 * When used inside an ERC-8183 job context, additional job-level checks:
 *   - JobEnvelope.x402.enabled
 *   - Job host allowlist
 *   - Per-job spend limit
 *   - maxCycles not exceeded
 *
 * Default: x402 disabled
 */

import type { PolicyConfig } from "@arclayer/runner-core";
import {
  isJobEnvelope,
  type JobEnvelopeV1,
} from "@arclayer/runner-core";

// ── Types ──────────────────────────────────────────────────────────────────

export type X402PaymentRequest = {
  url: string;
  method: string;
  body?: unknown;
  maxAmountUsdc: string;
  reason?: string;
  idempotencyKey?: string;
};

export type X402CycleState = {
  jobId?: string;
  cycleCount: number;
  totalSpentUsdc: number;
  paymentHistory: {
    url: string;
    amountUsdc: string;
    txHash?: string;
    timestamp: string;
  }[];
};

export type X402PolicyCheckResult = {
  allowed: boolean;
  reason?: string;
  idempotencyKey: string;
};

// ── Policy Engine ──────────────────────────────────────────────────────────

/**
 * Check if an x402 payment is allowed under the intersection of all policies.
 *
 * Standalone mode (no job context): checks runner policy + global limits only.
 * Job mode (with jobDescription): additionally checks job envelope x402 policy.
 */
export function checkX402Policy(params: {
  /** Runner-level policy config */
  runnerPolicy: PolicyConfig;
  /** Payment request */
  paymentRequest: X402PaymentRequest;
  /** Current cycle state */
  cycleState: X402CycleState;
  /** Global allowed hosts (from runner config) */
  globalAllowedHosts: string[];
  /** Global per-tx limit USDC */
  globalPerTxLimitUsdc: string;
  /** Optional: job description for job-level x402 policy */
  jobDescription?: string;
}): X402PolicyCheckResult {
  const {
    runnerPolicy,
    paymentRequest,
    cycleState,
    globalAllowedHosts,
    globalPerTxLimitUsdc,
    jobDescription,
  } = params;

  // 1. Runner paymentEnabled
  if (!runnerPolicy.paymentEnabled) {
    return {
      allowed: false,
      reason: "Runner payment policy is disabled",
      idempotencyKey: "",
    };
  }

  // 2. Extract host from URL
  const requestHost = extractHost(paymentRequest.url);
  if (!requestHost) {
    return {
      allowed: false,
      reason: "Cannot extract host from payment URL",
      idempotencyKey: "",
    };
  }

  // 3. Global host allowlist
  if (globalAllowedHosts.length > 0 && !globalAllowedHosts.includes(requestHost)) {
    return {
      allowed: false,
      reason: `Host ${requestHost} not in global allowlist`,
      idempotencyKey: "",
    };
  }

  // 4. Global per-tx limit
  const paymentAmount = parseFloat(paymentRequest.maxAmountUsdc);
  const globalLimit = parseFloat(globalPerTxLimitUsdc);
  if (paymentAmount > globalLimit) {
    return {
      allowed: false,
      reason: `Payment ${paymentAmount} USDC exceeds global per-tx limit ${globalLimit} USDC`,
      idempotencyKey: "",
    };
  }

  // 5. Job-level checks (only when job context provided)
  if (jobDescription && isJobEnvelope(jobDescription)) {
    const envelope = JSON.parse(jobDescription) as JobEnvelopeV1;
    const jobPolicy = envelope.x402;

    // Job x402 enabled
    if (!jobPolicy.enabled) {
      return {
        allowed: false,
        reason: "Job x402 policy is disabled",
        idempotencyKey: "",
      };
    }

    // Job host allowlist
    if (jobPolicy.allowedHosts.length > 0) {
      const jobHosts = jobPolicy.allowedHosts.map((h) => extractHost(h)).filter(Boolean);
      if (!jobHosts.includes(requestHost)) {
        return {
          allowed: false,
          reason: `Host ${requestHost} not in job allowlist`,
          idempotencyKey: "",
        };
      }
    }

    // Per-job spend limit
    const jobLimit = parseFloat(jobPolicy.maxSpendUsdc);
    const totalAfterPayment = cycleState.totalSpentUsdc + paymentAmount;
    if (totalAfterPayment > jobLimit) {
      return {
        allowed: false,
        reason: `Total spend ${totalAfterPayment.toFixed(6)} USDC would exceed job limit ${jobLimit} USDC`,
        idempotencyKey: "",
      };
    }

    // maxCycles
    if (cycleState.cycleCount >= jobPolicy.maxCycles) {
      return {
        allowed: false,
        reason: `Max cycles (${jobPolicy.maxCycles}) reached for this job`,
        idempotencyKey: "",
      };
    }
  }

  // Compute idempotency key
  const idempotencyKey = computeIdempotencyKey({
    jobId: cycleState.jobId,
    cycle: cycleState.cycleCount + 1,
    method: paymentRequest.method,
    url: paymentRequest.url,
    body: paymentRequest.body,
  });

  return { allowed: true, idempotencyKey };
}

/**
 * Create initial cycle state.
 */
export function createCycleState(jobId?: string): X402CycleState {
  return {
    jobId,
    cycleCount: 0,
    totalSpentUsdc: 0,
    paymentHistory: [],
  };
}

/**
 * Update cycle state after a successful payment.
 */
export function recordPayment(
  state: X402CycleState,
  payment: { url: string; amountUsdc: string; txHash?: string },
): X402CycleState {
  return {
    ...state,
    cycleCount: state.cycleCount + 1,
    totalSpentUsdc: state.totalSpentUsdc + parseFloat(payment.amountUsdc),
    paymentHistory: [
      ...state.paymentHistory,
      {
        url: payment.url,
        amountUsdc: payment.amountUsdc,
        txHash: payment.txHash,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function computeIdempotencyKey(params: {
  jobId?: string;
  cycle: number;
  method: string;
  url: string;
  body?: unknown;
}): string {
  const bodyStr = params.body ? JSON.stringify(params.body) : "";
  const keyMaterial = `x402:${params.jobId ?? "standalone"}:cycle${params.cycle}:${params.method}:${params.url}:${bodyStr}`;
  let hash = 0;
  for (let i = 0; i < keyMaterial.length; i++) {
    hash = ((hash << 5) - hash + keyMaterial.charCodeAt(i)) | 0;
  }
  return `x402:${params.jobId ?? "s"}:${Math.abs(hash).toString(36)}`;
}
