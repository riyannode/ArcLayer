import { RunnerError } from "@arclayer/runner-core";

const USDC_SCALE = 1_000_000n;

export type SpendPolicy = {
  status: "active" | "paused" | "disabled";
  walletAddress: string;
  role: string;
  accountType: "EOA" | "SCA";
  perTxLimitUsdc: string;
  dailyLimitUsdc: string;
  monthlyLimitUsdc: string;
  maxJobBudgetUsdc: string;
  requireApprovalAboveUsdc?: string;
  allowedContracts: string[];
  allowedMethods: string[];
  blockedMethods: string[];
  x402Enabled: boolean;
  gatewayEnabled: boolean;
};

export type SpendPolicyCheckInput = {
  policy: SpendPolicy;
  action: string;
  contract: string;
  method: string;
  amountUsdc?: string;
  dailySpentUsdc: string;
  monthlySpentUsdc: string;
};

export function usdcToMicros(value: string | number | undefined): bigint {
  if (value === undefined || value === null || value === "") return 0n;
  const raw = String(value).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) {
    throw new RunnerError("INVALID_USDC_AMOUNT", `Invalid USDC amount: ${raw}`, 400);
  }
  const [whole, fraction = ""] = raw.split(".");
  const padded = `${fraction}000000`.slice(0, 6);
  return BigInt(whole) * USDC_SCALE + BigInt(padded);
}

export function microsToUsdc(value: bigint): string {
  const whole = value / USDC_SCALE;
  const fraction = value % USDC_SCALE;
  return `${whole}.${fraction.toString().padStart(6, "0")}`;
}

export function assertSpendPolicy(input: SpendPolicyCheckInput): void {
  const {
    policy, action, contract, method,
    amountUsdc = "0", dailySpentUsdc, monthlySpentUsdc,
  } = input;

  if (policy.status !== "active") {
    throw new RunnerError("POLICY_DISABLED", `Wallet policy is ${policy.status}`, 403);
  }

  if (policy.blockedMethods.includes(method)) {
    throw new RunnerError("METHOD_BLOCKED", `Method is blocked by policy: ${method}`, 403);
  }

  if (policy.allowedMethods.length > 0 && !policy.allowedMethods.includes(method)) {
    throw new RunnerError("METHOD_NOT_ALLOWED", `Method is not allowed by policy: ${method}`, 403);
  }

  if (policy.allowedContracts.length > 0 && !policy.allowedContracts.includes(contract)) {
    throw new RunnerError("CONTRACT_NOT_ALLOWED", `Contract is not allowed by policy: ${contract}`, 403);
  }

  const amount = usdcToMicros(amountUsdc);
  const perTxLimit = usdcToMicros(policy.perTxLimitUsdc);
  const dailyLimit = usdcToMicros(policy.dailyLimitUsdc);
  const monthlyLimit = usdcToMicros(policy.monthlyLimitUsdc);
  const maxJobBudget = usdcToMicros(policy.maxJobBudgetUsdc);
  const dailySpent = usdcToMicros(dailySpentUsdc);
  const monthlySpent = usdcToMicros(monthlySpentUsdc);

  if (amount > perTxLimit) {
    throw new RunnerError("PER_TX_LIMIT_EXCEEDED",
      `Amount ${amountUsdc} USDC exceeds per-tx limit ${policy.perTxLimitUsdc} USDC`, 403);
  }
  if (dailySpent + amount > dailyLimit) {
    throw new RunnerError("DAILY_LIMIT_EXCEEDED",
      `Daily spend would exceed ${policy.dailyLimitUsdc} USDC`, 403);
  }
  if (monthlySpent + amount > monthlyLimit) {
    throw new RunnerError("MONTHLY_LIMIT_EXCEEDED",
      `Monthly spend would exceed ${policy.monthlyLimitUsdc} USDC`, 403);
  }
  if (action === "erc8183.setBudget" && amount > maxJobBudget) {
    throw new RunnerError("JOB_BUDGET_LIMIT_EXCEEDED",
      `Job budget ${amountUsdc} USDC exceeds max job budget ${policy.maxJobBudgetUsdc} USDC`, 403);
  }
  if (policy.requireApprovalAboveUsdc) {
    const threshold = usdcToMicros(policy.requireApprovalAboveUsdc);
    if (amount > threshold) {
      throw new RunnerError("MANUAL_APPROVAL_REQUIRED",
        `Amount ${amountUsdc} USDC requires manual approval`, 409);
    }
  }
  if (action.startsWith("x402.") && !policy.x402Enabled) {
    throw new RunnerError("X402_DISABLED_BY_POLICY", "x402 is disabled by wallet policy", 403);
  }
  if (action.startsWith("gateway.") && !policy.gatewayEnabled) {
    throw new RunnerError("GATEWAY_DISABLED_BY_POLICY", "Gateway is disabled by wallet policy", 403);
  }
  if (action.startsWith("x402.") && policy.accountType !== "EOA") {
    throw new RunnerError("X402_REQUIRES_EOA", "x402 Gateway Nanopayments require EOA wallet", 403);
  }
}
