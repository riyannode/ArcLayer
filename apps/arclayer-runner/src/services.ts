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
  assertX402PaymentAllowed,
  decimalToMicros,
  erc8183Hash,
  sha256Json,
  RunnerError,
  type RunnerConfig
} from "@arclayer/runner-core";
import { CircleCliAdapter } from "@arclayer/circle-cli-adapter";
import { buildSubmitDeliverableConfig } from "@arclayer/sdk";
import type { RuntimeConnector } from "./runtime";
import type { ArcLayerMcpConnector } from "./mcp-connector";
import { randomUUID } from "node:crypto";

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

  /**
   * Generic task dispatch to LLM runtime.
   * Validates identity, role, and policy before forwarding.
   */
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

    // Delegate to existing MCP server
    const mcpResult = await this.mcp.prepareRegisterAgent(input.metadataURI);

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
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

  /**
   * Run ERC-8183 provider job lifecycle.
   *
   * Flow:
   * 1. Validate identity + role
   * 2. Notify MCP: start job run
   * 3. Dispatch to LLM runtime for execution
   * 4. Compute deliverable hash
   * 5. Prepare submit calldata via MCP
   * 6. Execute on-chain submit via Circle CLI (allowlisted method only)
   * 7. Notify MCP: complete job run
   * 8. Store receipt with proof
   */
  async runErc8183ProviderJob(body: unknown) {
    const job = Erc8183ProviderJobSchema.parse(body);
    assertAgentIdentity(this.config, job.agentId);
    assertRoleAllowed(this.config, "provider");
    assertProviderOnlyForExternal(this.config, "provider");

    // ── Step 1: Notify MCP — start job run ──────────────────────────────
    await this.mcp.startJobRun(job.jobId).catch((err) => {
      // Non-fatal: MCP state tracking is advisory for external runners
      console.warn(`[runner] MCP startJobRun failed: ${err.message}`);
    });

    // ── Step 2: Dispatch to LLM runtime ─────────────────────────────────
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

    // ── Step 3: Prepare submit calldata via MCP ─────────────────────────
    const preparedTx = await this.mcp.prepareSubmitDeliverable(
      job.jobId,
      deliverableHash
    ).catch((err) => {
      console.warn(`[runner] MCP prepareSubmitDeliverable failed: ${err.message}`);
      return null;
    });

    // Also build local tx config (SDK)
    const tx = buildSubmitDeliverableConfig(BigInt(job.jobId), deliverableHash);

    // ── Step 4: Execute on-chain submit via Circle CLI ──────────────────
    const submitReceipt = await this.submitDeliverableViaCircleCli({
      jobId: job.jobId,
      deliverableHash,
      optParams: "0x"
    });

    // ── Step 5: Notify MCP — complete job run ───────────────────────────
    await this.mcp.completeJobRun(job.jobId, result.output).catch((err) => {
      console.warn(`[runner] MCP completeJobRun failed: ${err.message}`);
    });

    // ── Step 6: Store receipt ───────────────────────────────────────────
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

  /**
   * Submit deliverable on-chain via Circle CLI.
   * Only allowlisted method: submit(uint256,bytes32,bytes).
   */
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
   */
  async inspectX402(body: unknown) {
    const payment = PaymentRequestSchema.parse(body);
    assertX402PaymentAllowed(this.config, payment);

    const result = await this.circle.inspectService({
      url: payment.url,
      method: payment.method,
      body: payment.body
    });

    return { ok: true, result };
  }

  /**
   * Pay an x402 service with idempotency and persistent spending limits.
   */
  async payX402(body: unknown) {
    const payment = PaymentRequestSchema.parse(body);
    assertX402PaymentAllowed(this.config, payment);

    // ── Idempotency ─────────────────────────────────────────────────────
    const idempotencyKey = payment.idempotencyKey ?? randomUUID();

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

    // ── Persistent spending limits ──────────────────────────────────────
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
  }

  /**
   * Batch pay x402 services with per-item idempotency.
   */
  async batchPayX402(body: unknown) {
    const batch = BatchPaymentRequestSchema.parse(body);
    assertBatchAllowed(this.config, batch.payments);

    const results = [];

    for (const payment of batch.payments) {
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
      request: batch,
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
