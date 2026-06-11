import {
  AgentTaskSchema,
  BatchPaymentRequestSchema,
  Erc8183ProviderJobSchema,
  JsonlReceiptStore,
  SpendingLedger,
  PaymentRequestSchema,
  assertAgentIdentity,
  assertBatchAllowed,
  assertDailyLimit,
  assertMonthlyLimit,
  assertProviderOnlyForExternal,
  assertRoleAllowed,
  assertX402InspectAllowed,
  assertX402PaymentAllowed,
  decimalToMicros,
  erc8183Hash,
  sha256Json,
  sha256Text,
  RunnerError,
  type RunnerConfig
} from "@arclayer/runner-core";
import { CircleCliAdapter } from "@arclayer/circle-cli-adapter";
import { buildSubmitDeliverableConfig } from "@arclayer/sdk";
import type { RuntimeConnector } from "./runtime";
import type { ArcLayerMcpConnector } from "./mcp-connector";
import { randomUUID } from "node:crypto";

/**
 * In-memory lock per idempotencyKey.
 * Prevents concurrent requests with the same key from double-paying.
 * Only effective within a single process — multi-process needs external lock.
 */
const pendingLocks = new Map<string, Promise<void>>();

function acquireKeyLock(key: string): Promise<void> {
  const prev = pendingLocks.get(key) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  pendingLocks.set(key, prev.then(() => next));
  return prev.then(() => {});
}

function releaseKeyLock(key: string): void {
  // The lock resolves when the next() promise resolves.
  // We trigger it by resolving the stored promise.
  // Actually we need to resolve the 'next' promise. Let's use a different approach.
}

// Simpler approach: per-key mutex using a queue
const keyQueues = new Map<string, { busy: boolean; queue: Array<() => void> }>();

async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!keyQueues.has(key)) {
    keyQueues.set(key, { busy: false, queue: [] });
  }
  const entry = keyQueues.get(key)!;

  if (entry.busy) {
    // Wait for current holder to finish
    await new Promise<void>((resolve) => entry.queue.push(resolve));
  }

  entry.busy = true;
  try {
    return await fn();
  } finally {
    entry.busy = false;
    const next = entry.queue.shift();
    if (next) next();
    if (!entry.busy && entry.queue.length === 0) {
      keyQueues.delete(key);
    }
  }
}

export class RunnerServices {
  readonly receipts: JsonlReceiptStore;
  readonly ledger: SpendingLedger;
  readonly circle: CircleCliAdapter;

  constructor(
    readonly config: RunnerConfig,
    readonly runtime: RuntimeConnector,
    readonly mcp: ArcLayerMcpConnector,
    readonly skill: { content: string; sha256: string; path: string }
  ) {
    this.receipts = new JsonlReceiptStore(config.dataDir);
    this.ledger = new SpendingLedger(config.dataDir);
    this.circle = new CircleCliAdapter({ bin: config.circleCliBin });
  }

  manifest() {
    return {
      name: "ArcLayer Runner",
      runnerId: this.config.runnerId,
      agentId: this.config.agentId,
      agentAddress: this.config.agentAddress,
      runtimeKind: this.config.runtimeKind,
      runtimeEndpoint: this.config.runtimeEndpoint,
      runtimeRunPath: this.config.runtimeRunPath,
      defaultRole: this.config.defaultRole,
      allowedRoles: this.config.allowedRoles,
      skillHash: this.skill.sha256,
      capabilities: [
        "global_skill_server",
        "runtime_connector",
        "erc8004_identity_guard",
        "erc8183_provider_lifecycle",
        "x402_nanopayment",
        "batch_payment",
        "circle_cli_adapter",
        "receipt_proof_store",
        "spending_ledger",
        "mcp_bridge",
        "auth_gated"
      ]
    };
  }

  async runGeneric(body: unknown) {
    const task = AgentTaskSchema.parse(body);
    assertAgentIdentity(this.config, task.agentId);
    assertRoleAllowed(this.config, task.role);
    assertProviderOnlyForExternal(this.config, task.role);

    const result = await this.runtime.run(task);
    const receipt = await this.receipts.append({
      type: "runtime_result",
      taskId: task.taskId,
      agentId: task.agentId,
      request: task,
      response: result,
      proof: { sha256: sha256Json(result) }
    });

    return { ok: true, result, receipt };
  }

  /**
   * Prepare ERC-8004 registration.
   * Delegates to existing MCP server's identity.prepare_register_agent.
   * Returns unsigned tx data — never signs or broadcasts.
   */
  async prepareRegister(body: unknown) {
    const parsed = AgentTaskSchema.parse({
      taskId: "prepare-register",
      protocol: "erc8004",
      role: "provider",
      agentId: this.config.agentId,
      input: body
    });

    assertAgentIdentity(this.config, parsed.agentId);

    const input = parsed.input as { metadataURI?: string };
    if (!input.metadataURI) {
      throw new RunnerError("MISSING_FIELD", "metadataURI is required", 400);
    }

    const mcpResult = await this.mcp.prepareRegisterAgent(input.metadataURI);

    const receipt = await this.receipts.append({
      type: "erc8004_prepare_register",
      taskId: parsed.taskId,
      agentId: this.config.agentId,
      request: { metadataURI: input.metadataURI },
      response: mcpResult,
      proof: { sha256: sha256Json(mcpResult) }
    });

    return {
      ok: true,
      mode: "prepare-only",
      mcpResult,
      receipt,
      warning: "Runner delegates to existing MCP server. It does not invent identity or bypass wallet approval."
    };
  }

  async runErc8183ProviderJob(body: unknown) {
    const job = Erc8183ProviderJobSchema.parse(body);
    assertAgentIdentity(this.config, job.agentId);
    assertRoleAllowed(this.config, "provider");
    assertProviderOnlyForExternal(this.config, "provider");

    await this.mcp.startJobRun(job.jobId).catch((err) => {
      console.warn(`[runner] MCP startJobRun failed: ${err.message}`);
    });

    const runtimeTask = {
      taskId: job.taskId,
      protocol: "erc8183" as const,
      role: "provider" as const,
      agentId: job.agentId,
      input: job.input,
      metadata: {
        ...job.metadata,
        jobId: job.jobId,
        provider: job.provider,
        evaluator: job.evaluator,
        description: job.description
      }
    };

    const result = await this.runtime.run(runtimeTask);
    const deliverableHash = erc8183Hash(result.output ?? result);

    const preparedTx = await this.mcp.prepareSubmitDeliverable(
      job.jobId,
      deliverableHash
    ).catch((err) => {
      console.warn(`[runner] MCP prepareSubmitDeliverable failed: ${err.message}`);
      return null;
    });

    const tx = buildSubmitDeliverableConfig(BigInt(job.jobId), deliverableHash);

    const submitReceipt = await this.submitDeliverableViaCircleCli({
      jobId: job.jobId,
      deliverableHash,
      optParams: "0x"
    });

    await this.mcp.completeJobRun(job.jobId, result.output).catch((err) => {
      console.warn(`[runner] MCP completeJobRun failed: ${err.message}`);
    });

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: job.taskId,
      jobId: job.jobId,
      agentId: job.agentId,
      request: job,
      response: { result, tx, preparedTx, submitReceipt },
      proof: {
        deliverableHash,
        sha256: sha256Json({ result, tx, submitReceipt }),
        txHash: extractPossibleTxHash(submitReceipt)
      }
    });

    return {
      ok: true,
      role: "provider",
      result,
      deliverableHash,
      tx,
      submitReceipt,
      receipt
    };
  }

  async submitDeliverableViaCircleCli(input: {
    jobId: string;
    deliverableHash: `0x${string}`;
    optParams?: `0x${string}`;
  }) {
    if (!this.config.erc8183ContractAddress) {
      return {
        ok: false,
        mode: "prepared-only",
        reason: "ARCLAYER_ERC8183_CONTRACT not configured",
        prepared: input
      };
    }

    if (!this.config.circleWalletAddress) {
      return {
        ok: false,
        mode: "prepared-only",
        reason: "CIRCLE_WALLET_ADDRESS not configured",
        prepared: input
      };
    }

    return this.circle.executeAllowedArcWrite({
      signature: "submit(uint256,bytes32,bytes)",
      params: [input.jobId, input.deliverableHash, input.optParams ?? "0x"],
      contract: this.config.erc8183ContractAddress,
      address: this.config.circleWalletAddress,
      chain: this.config.chain
    });
  }

  /**
   * Inspect an x402 service (read-only, no payment).
   * Only requires URL validation and host allowlist.
   * Does NOT require paymentEnabled or wallet.
   */
  async inspectX402(body: unknown) {
    const payment = PaymentRequestSchema.parse(body);
    assertX402InspectAllowed(this.config, payment);

    const result = await this.circle.inspectService({
      url: payment.url,
      method: payment.method,
      body: payment.body
    });

    return { ok: true, result };
  }

  /**
   * Pay an x402 service with idempotency and persistent spending limits.
   *
   * Concurrency safety:
   * 1. Per-key in-memory lock prevents same-key double-pay within process.
   * 2. If key already succeeded → return existing receipt.
   * 3. If key has pending attempt → return 409 PAYMENT_IN_PROGRESS.
   * 4. If key failed → allow retry.
   */
  async payX402(body: unknown) {
    const payment = PaymentRequestSchema.parse(body);
    assertX402PaymentAllowed(this.config, payment);

    const idempotencyKey = payment.idempotencyKey ?? randomUUID();

    return withKeyLock(idempotencyKey, async () => {
      // ── Check if already succeeded ──────────────────────────────────
      const existing = await this.ledger.hasSucceeded(idempotencyKey);
      if (existing) {
        const existingReceipt = existing.receiptId
          ? await this.receipts.findByIdempotencyKey(idempotencyKey)
          : undefined;
        return {
          ok: true,
          idempotent: true,
          message: "Payment already completed with this idempotencyKey",
          ledger: existing,
          receipt: existingReceipt
        };
      }

      // ── Check if payment is already in progress ─────────────────────
      const pending = await this.ledger.hasPendingAttempt(idempotencyKey);
      if (pending) {
        throw new RunnerError(
          "PAYMENT_IN_PROGRESS",
          `Payment with idempotencyKey ${idempotencyKey} is already in progress`,
          409
        );
      }

      // ── Persistent spending limits ──────────────────────────────────
      await assertDailyLimit(this.config, this.ledger, payment.maxAmountUsdc);
      await assertMonthlyLimit(this.config, this.ledger, payment.maxAmountUsdc);

      const amountMicros = decimalToMicros(payment.maxAmountUsdc).toString();

      await this.ledger.recordAttempt({
        idempotencyKey,
        amountUsdc: payment.maxAmountUsdc,
        amountMicros,
        url: payment.url,
        reason: payment.reason
      });

      try {
        const result = await this.circle.payService({
          url: payment.url,
          method: payment.method,
          body: payment.body,
          maxAmountUsdc: payment.maxAmountUsdc,
          address: this.config.circleWalletAddress!,
          chain: this.config.chain
        });

        const receipt = await this.receipts.append({
          type: "x402_payment",
          agentId: this.config.agentId,
          idempotencyKey,
          request: payment,
          response: result,
          proof: {
            circleCommand: [result.command, ...result.args].join(" "),
            sha256: sha256Json(result)
          }
        });

        await this.ledger.recordSuccess(idempotencyKey, receipt.id);
        return { ok: true, result, receipt, idempotencyKey };
      } catch (error) {
        await this.ledger.recordFailure(
          idempotencyKey,
          error instanceof Error ? error.message : String(error)
        );

        await this.receipts.append({
          type: "x402_payment",
          agentId: this.config.agentId,
          idempotencyKey,
          request: payment,
          error: error instanceof Error ? error.message : String(error)
        });

        throw error;
      }
    });
  }

  /**
   * Batch pay x402 services with deterministic idempotency keys.
   *
   * BatchPaymentRequest requires batchId for retry safety.
   * Items without idempotencyKey get deterministic key:
   *   batch:<batchId>:item:<index>:<sha256(url+method+body+maxAmountUsdc)>
   */
  async batchPayX402(body: unknown) {
    const batch = BatchPaymentRequestSchema.parse(body);

    // Derive deterministic keys for items without idempotencyKey
    const payments = batch.payments.map((p, i) => {
      if (p.idempotencyKey) return p;
      const keyMaterial = `${p.url}|${p.method}|${JSON.stringify(p.body ?? "")}|${p.maxAmountUsdc}`;
      const hash = sha256Text(keyMaterial).slice(0, 16);
      return {
        ...p,
        idempotencyKey: `batch:${batch.batchId}:item:${i}:${hash}`
      };
    });

    assertBatchAllowed(this.config, payments);

    const results = [];

    for (const payment of payments) {
      try {
        const result = await this.payX402(payment);
        results.push({ ok: true, payment, result });
      } catch (error) {
        results.push({
          ok: false,
          payment,
          error: error instanceof Error ? error.message : String(error)
        });
        break;
      }
    }

    const receipt = await this.receipts.append({
      type: "x402_payment",
      taskId: batch.taskId,
      agentId: this.config.agentId,
      request: { ...batch, payments },
      response: results,
      proof: { sha256: sha256Json(results) }
    });

    return { ok: true, results, receipt };
  }

  async circleStatus() {
    const [version, status, gatewayBalance] = await Promise.allSettled([
      this.circle.version(),
      this.circle.walletStatus(),
      this.config.circleWalletAddress
        ? this.circle.gatewayBalance(this.config.circleWalletAddress, this.config.chain)
        : Promise.resolve(undefined)
    ]);

    const response = { version, status, gatewayBalance };

    const receipt = await this.receipts.append({
      type: "circle_status",
      agentId: this.config.agentId,
      response,
      proof: { sha256: sha256Json(response) }
    });

    return { ok: true, response, receipt };
  }

  async getLedger(limit: number) {
    return {
      ok: true,
      records: await this.ledger.list(limit)
    };
  }
}

function extractPossibleTxHash(value: unknown): string | undefined {
  const text = JSON.stringify(value);
  const match = text.match(/0x[a-fA-F0-9]{64}/);
  return match?.[0];
}
