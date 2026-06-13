import { RunnerError } from "./errors";
import type { PaymentRequest, RunnerConfig, RunnerRole } from "./types";
import type { SpendingLedger } from "./ledger";

function isHostAllowed(allowedHosts: string[], host: string): boolean {
  if (allowedHosts.length === 0) return true;
  if (allowedHosts.includes("*")) return true;
  return allowedHosts.includes(host);
}



export function decimalToMicros(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole || "0") * 1_000_000n + BigInt(fracPadded || "0");
}

export function assertRoleAllowed(config: RunnerConfig, role: RunnerRole): void {
  if (!config.allowedRoles.includes(role)) {
    throw new RunnerError(
      "ROLE_NOT_ALLOWED",
      `Runner role ${role} is not allowed for agent ${config.agentId}`,
      403
    );
  }
}

/**
 * @deprecated — assertRoleAllowed already covers this. Kept as no-op for backward compat.
 * Previously blocked all non-provider roles when defaultRole=provider,
 * which was too restrictive for evaluator/client runners with separate wallets.
 */
export function assertProviderOnlyForExternal(_config: RunnerConfig, _role: RunnerRole): void {
  // No-op. assertRoleAllowed handles role gating.
}

export function assertAgentIdentity(config: RunnerConfig, agentId: string): void {
  if (config.agentId !== agentId) {
    throw new RunnerError(
      "AGENT_ID_MISMATCH",
      `Task agentId ${agentId} does not match runner agentId ${config.agentId}`,
      403
    );
  }
}

/**
 * Assert that an x402 inspect request is allowed.
 * Inspect is read-only — does NOT require paymentEnabled or wallet.
 * Only validates URL and host allowlist.
 */
export function assertX402InspectAllowed(config: RunnerConfig, payment: PaymentRequest): void {
  const host = new URL(payment.url).host;
  if (!isHostAllowed(config.allowedX402Hosts, host)) {
    throw new RunnerError("X402_HOST_NOT_ALLOWED", `Host ${host} is not allowed`, 403);
  }
}

export function assertX402PaymentAllowed(config: RunnerConfig, payment: PaymentRequest): void {
  if (!config.paymentEnabled) {
    throw new RunnerError("PAYMENT_DISABLED", "Payments are disabled for this runner", 403);
  }

  if (!config.circleWalletAddress) {
    throw new RunnerError("CIRCLE_WALLET_MISSING", "Circle wallet address is not configured", 400);
  }

  const host = new URL(payment.url).host;
  if (!isHostAllowed(config.allowedX402Hosts, host)) {
    throw new RunnerError("X402_HOST_NOT_ALLOWED", `Host ${host} is not allowed`, 403);
  }

  const amount = decimalToMicros(payment.maxAmountUsdc);
  const perTx = decimalToMicros(config.perTxLimitUsdc);
  if (amount > perTx) {
    throw new RunnerError(
      "PER_TX_LIMIT_EXCEEDED",
      `Payment ${payment.maxAmountUsdc} exceeds per-tx limit ${config.perTxLimitUsdc}`,
      403
    );
  }
}

export function assertBatchAllowed(config: RunnerConfig, payments: PaymentRequest[]): void {
  if (payments.length > config.batchMaxItems) {
    throw new RunnerError(
      "BATCH_MAX_ITEMS_EXCEEDED",
      `Batch has ${payments.length} payments but limit is ${config.batchMaxItems}`,
      403
    );
  }

  let total = 0n;
  for (const payment of payments) {
    assertX402PaymentAllowed(config, payment);
    total += decimalToMicros(payment.maxAmountUsdc);
  }

  const maxTotal = decimalToMicros(config.batchMaxTotalUsdc);
  if (total > maxTotal) {
    throw new RunnerError(
      "BATCH_MAX_TOTAL_EXCEEDED",
      `Batch exceeds max total ${config.batchMaxTotalUsdc} USDC`,
      403
    );
  }
}

/**
 * Assert daily spending limit not exceeded.
 * Computes from persistent ledger records, not in-memory counters.
 */
export async function assertDailyLimit(
  config: RunnerConfig,
  ledger: SpendingLedger,
  additionalAmountUsdc: string
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const dailySpent = await ledger.sumSuccessfulByDay(today);
  const additional = decimalToMicros(additionalAmountUsdc);
  const limit = decimalToMicros(config.dailyLimitUsdc);

  if (dailySpent + additional > limit) {
    throw new RunnerError(
      "DAILY_LIMIT_EXCEEDED",
      `Daily spending limit exceeded: spent ${dailySpent} micros today, adding ${additional} micros, limit ${limit} micros`,
      403
    );
  }
}

/**
 * Assert monthly spending limit not exceeded.
 * Computes from persistent ledger records, not in-memory counters.
 */
export async function assertMonthlyLimit(
  config: RunnerConfig,
  ledger: SpendingLedger,
  additionalAmountUsdc: string
): Promise<void> {
  const month = new Date().toISOString().slice(0, 7);
  const monthlySpent = await ledger.sumSuccessfulByMonth(month);
  const additional = decimalToMicros(additionalAmountUsdc);
  const limit = decimalToMicros(config.monthlyLimitUsdc);

  if (monthlySpent + additional > limit) {
    throw new RunnerError(
      "MONTHLY_LIMIT_EXCEEDED",
      `Monthly spending limit exceeded: spent ${monthlySpent} micros this month, adding ${additional} micros, limit ${limit} micros`,
      403
    );
  }
}
