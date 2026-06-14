/**
 * X402Coordinator — autonomous x402 payment and runtime resume.
 *
 * Handles RuntimeResult.status == "needs_payment" by:
 * 1. Validating payment requests against job policy
 * 2. Inspecting x402 services
 * 3. Paying through existing RunnerServices.payX402
 * 4. Resuming runtime with payment receipts
 *
 * Builds ON TOP of:
 * - RunnerServices.inspectX402 / payX402
 * - SpendingLedger, JsonlReceiptStore
 * - RuntimeConnector (resume after payment)
 */
import { createHash } from "node:crypto";
import type { RuntimeResult, AgentTask, PaymentRequest } from "@arclayer/runner-core";
import type { RunnerServices } from "../services";
import type { RuntimeConnector } from "../runtime";
import type { AutonomyStore } from "./autonomy-store";

export type X402JobPolicy = {
  allowed: boolean;
  maxSpendUsdc: string;
  allowedHosts: string[];
};

export type X402CoordinatorConfig = {
  x402ResumeEnabled: boolean;
  maxX402CyclesPerJob: number;
  maxX402SpendPerJobUsdc: string;
  globalAllowedHosts: string[];
};

export type PaidResource = {
  request: PaymentRequest;
  receiptId: string;
  idempotencyKey: string;
  response: unknown;
  amountLimitUsdc: string;
};

export type X402ResumeResult = {
  status: "completed" | "failed" | "needs_payment" | "needs_action";
  result: RuntimeResult;
  paidResources: PaidResource[];
  cyclesUsed: number;
};

export class X402Coordinator {
  constructor(
    private readonly services: RunnerServices,
    private readonly config: X402CoordinatorConfig
  ) {}

  /**
   * Fulfill x402 payment requests and resume runtime.
   */
  async fulfillAndResume(input: {
    workflowId: string;
    jobId: string;
    originalTask: AgentTask;
    runtimeResult: RuntimeResult;
    runtime: RuntimeConnector;
    jobPolicy: X402JobPolicy;
  }): Promise<X402ResumeResult> {
    // ── Pre-flight checks ───────────────────────────────────────────────
    if (!this.config.x402ResumeEnabled) {
      return {
        status: "failed",
        result: { ...input.runtimeResult, status: "failed", error: "x402 resume is disabled" },
        paidResources: [],
        cyclesUsed: 0,
      };
    }

    if (!input.jobPolicy.allowed) {
      return {
        status: "failed",
        result: { ...input.runtimeResult, status: "failed", error: "x402 not allowed by job policy" },
        paidResources: [],
        cyclesUsed: 0,
      };
    }

    const paymentRequests = input.runtimeResult.paymentRequests ?? [];
    if (paymentRequests.length === 0) {
      return {
        status: "failed",
        result: { ...input.runtimeResult, status: "failed", error: "No payment requests provided" },
        paidResources: [],
        cyclesUsed: 0,
      };
    }

    // ── Validate each payment request ───────────────────────────────────
    const paidResources: PaidResource[] = [];
    let totalSpendMicros = 0n;
    const maxSpendMicros = this.parseUsdcToMicros(this.config.maxX402SpendPerJobUsdc);
    const jobMaxSpendMicros = this.parseUsdcToMicros(input.jobPolicy.maxSpendUsdc);

    for (const request of paymentRequests) {
      // Host allowlist check
      const host = this.extractHost(request.url);
      if (!this.isHostAllowed(host, input.jobPolicy.allowedHosts)) {
        return {
          status: "failed",
          result: { ...input.runtimeResult, status: "failed", error: `Host not in allowlist: ${host}` },
          paidResources,
          cyclesUsed: 0,
        };
      }

      // Amount checks
      const requestAmountMicros = this.parseUsdcToMicros(request.maxAmountUsdc ?? "0");

      // Per-transaction policy
      // Job max spend
      if (totalSpendMicros + requestAmountMicros > jobMaxSpendMicros) {
        return {
          status: "failed",
          result: { ...input.runtimeResult, status: "failed", error: `Amount exceeds job max spend: ${input.jobPolicy.maxSpendUsdc} USDC` },
          paidResources,
          cyclesUsed: 0,
        };
      }

      // Autonomy max spend
      if (totalSpendMicros + requestAmountMicros > maxSpendMicros) {
        return {
          status: "failed",
          result: { ...input.runtimeResult, status: "failed", error: `Amount exceeds autonomy max spend: ${this.config.maxX402SpendPerJobUsdc} USDC` },
          paidResources,
          cyclesUsed: 0,
        };
      }

      // Generate deterministic payment key
      const requestHash = this.computeRequestHash(request);
      const idempotencyKey = `x402:${input.jobId}:${request.url}:${requestHash.slice(0, 16)}`;

      // Inspect before pay
      try {
        await this.services.inspectX402({
          url: request.url,
          method: request.method ?? "GET",
        });
      } catch (err) {
        // Inspect failure is not blocking — proceed to pay
      }

      // Pay
      const payResult = await this.services.payX402({
        url: request.url,
        method: request.method ?? "GET",
        maxAmountUsdc: request.maxAmountUsdc ?? "0.01",
        idempotencyKey,
      });

      if (!payResult.ok) {
        return {
          status: "failed",
          result: { ...input.runtimeResult, status: "failed", error: `Payment failed: ${payResult.error ?? "unknown"}` },
          paidResources,
          cyclesUsed: 0,
        };
      }

      paidResources.push({
        request,
        receiptId: payResult.receiptId ?? idempotencyKey,
        idempotencyKey,
        response: payResult.result,
        amountLimitUsdc: request.maxAmountUsdc ?? "0.01",
      });

      totalSpendMicros += requestAmountMicros;
    }

    // ── Resume runtime with payment receipts ────────────────────────────
    const resumeTask: AgentTask = {
      ...input.originalTask,
      metadata: {
        ...input.originalTask.metadata,
        arclayerResume: {
          version: 1,
          workflowId: input.workflowId,
          jobId: input.jobId,
          cycle: 1,
          previousStatus: "needs_payment",
          paidResources: paidResources.map((p) => ({
            requestHash: this.computeRequestHash(p.request),
            receiptId: p.receiptId,
            idempotencyKey: p.idempotencyKey,
            response: p.response,
          })),
        },
      },
    };

    const resumedResult = await input.runtime.run(resumeTask);

    return {
      status: resumedResult.status as any,
      result: resumedResult,
      paidResources,
      cyclesUsed: 1,
    };
  }

  private extractHost(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }

  private isHostAllowed(host: string, jobHosts: string[]): boolean {
    if (!host) return false;
    // Check job-level allowlist
    if (jobHosts.length > 0 && !jobHosts.some((h) => h === host || host.endsWith(`.${h}`))) {
      return false;
    }
    // Check global allowlist
    if (this.config.globalAllowedHosts.length > 0) {
      return this.config.globalAllowedHosts.some((h) => h === host || host.endsWith(`.${h}`));
    }
    return true;
  }

  private parseUsdcToMicros(usdc: string): bigint {
    const [whole, frac = ""] = usdc.split(".");
    const padded = frac.padEnd(6, "0").slice(0, 6);
    return BigInt(whole!) * 1000000n + BigInt(padded);
  }

  private computeRequestHash(request: PaymentRequest): string {
    return createHash("sha256")
      .update(JSON.stringify({
        url: request.url,
        method: request.method ?? "GET",
        maxAmountUsdc: request.maxAmountUsdc,
      }))
      .digest("hex");
  }
}
