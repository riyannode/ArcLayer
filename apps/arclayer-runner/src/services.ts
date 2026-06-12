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
import { CONTRACTS } from "@arclayer/sdk";
import type { RuntimeConnector } from "./runtime";
import type { ArcLayerMcpConnector } from "./mcp-connector";
import { randomUUID } from "node:crypto";

/**
 * In-memory lock per idempotencyKey.
 * Prevents concurrent requests with the same key from double-paying.
 */
const keyQueues = new Map<string, { busy: boolean; queue: Array<() => void> }>();

async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!keyQueues.has(key)) {
    keyQueues.set(key, { busy: false, queue: [] });
  }
  const entry = keyQueues.get(key)!;

  if (entry.busy) {
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

    // Step 1: Start MCP run
    const startResult = await this.mcp.startJobRun(job.jobId).catch((err) => {
      console.warn(`[runner] MCP startJobRun failed: ${err.message}`);
      return null;
    });
    const runId = (startResult as any)?.runId;

    // Step 2: Dispatch to LLM runtime
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

    // Step 3: Check runtime result before proceeding with settlement
    if (!result.ok || result.status === "failed") {
      // Runtime reported failure — do NOT submit on-chain
      // Record failure via local receipt only (no hosted MCP fail_job tool exists)
      // Optionally write checkpoint if MCP is available
      await this.mcp.writeCheckpoint(job.jobId, {
        status: "failed",
        error: result.error ?? "Runtime returned failure"
      }).catch(() => {});

      const receipt = await this.receipts.append({
        type: "erc8183_submit",
        taskId: job.taskId,
        jobId: job.jobId,
        agentId: job.agentId,
        request: job,
        response: { result, skipped: true, reason: "runtime_failure" },
        proof: { sha256: sha256Json(result) }
      });

      return {
        ok: false,
        status: "runtime_failure",
        role: "provider",
        result,
        receipt,
        error: result.error ?? "Runtime returned ok=false or status=failed"
      };
    }

    // Step 4: Hash deliverable and prepare submit
    const deliverableHash = erc8183Hash(result.output ?? result);

    const preparedTx = await this.mcp.prepareSubmitDeliverable(
      job.jobId,
      deliverableHash
    ).catch((err) => {
      console.warn(`[runner] MCP prepareSubmitDeliverable failed: ${err.message}`);
      return null;
    });

    // Step 5: Execute on-chain submit via Circle CLI
    const submitReceipt = await this.submitDeliverableViaCircleCli({
      jobId: job.jobId,
      deliverableHash,
      optParams: "0x"
    });

    // Step 6: If submit was prepared-only (no contract/wallet), stop here
    if (submitReceipt && typeof submitReceipt === "object" && "ok" in submitReceipt && !submitReceipt.ok) {
      const receipt = await this.receipts.append({
        type: "erc8183_submit",
        taskId: job.taskId,
        jobId: job.jobId,
        agentId: job.agentId,
        request: job,
        response: { result, preparedTx, submitReceipt },
        proof: {
          deliverableHash,
          sha256: sha256Json({ result, submitReceipt })
        }
      });

      return {
        ok: false,
        status: "prepared-only",
        role: "provider",
        result,
        deliverableHash,
        submitReceipt,
        receipt,
        error: submitReceipt.reason ?? "On-chain submit not available"
      };
    }

    // Step 7: Complete MCP run
    await this.mcp.completeJobRun(job.jobId, result.output, runId).catch((err) => {
      console.warn(`[runner] MCP completeJobRun failed: ${err.message}`);
    });

    // Step 8: Store receipt with proof
    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: job.taskId,
      jobId: job.jobId,
      agentId: job.agentId,
      request: job,
      response: { result, preparedTx, submitReceipt },
      proof: {
        deliverableHash,
        sha256: sha256Json({ result, submitReceipt }),
        txHash: extractPossibleTxHash(submitReceipt)
      }
    });

    return {
      ok: true,
      role: "provider",
      result,
      deliverableHash,
      submitReceipt,
      receipt
    };
  }

  async submitDeliverableViaCircleCli(input: {
    jobId: string;
    deliverableHash: `0x${string}`;
    optParams?: `0x${string}`;
  }) {
    if (!this.config.circleWalletAddress) {
      return {
        ok: false,
        mode: "prepared-only",
        reason: "CIRCLE_WALLET_ADDRESS not configured",
        prepared: input
      };
    }

    // Always use canonical SDK contract target (Arc Testnet).
    // circle.chain is for Circle CLI wallet ops only — contract target is hardcoded.
    const contractAddress = CONTRACTS.ERC8183_AGENTIC_COMMERCE;

    return this.circle.executeErc8183Write({
      signature: "submit(uint256,bytes32,bytes)",
      params: [input.jobId, input.deliverableHash, input.optParams ?? "0x"],
      contract: contractAddress,
      address: this.config.circleWalletAddress,
      chain: this.config.chain
    });
  }

  // ── ERC-8183 Full Lifecycle ──────────────────────────────────────────────

  /**
   * Create a new ERC-8183 job on-chain.
   * Signature: createJob(provider, evaluator, expiredAt, description, hook)
   * hook is an address (not bytes) — the callback contract.
   */
  async createJob(body: unknown) {
    const input = body as {
      provider: string;
      evaluator: string;
      expiredAt: string | number;
      description: string;
      hook?: string;
    };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    const result = await this.circle.executeErc8183Write({
      signature: "createJob(address,address,uint256,string,address)",
      params: [
        input.provider,
        input.evaluator,
        String(input.expiredAt),
        input.description,
        input.hook ?? "0x0000000000000000000000000000000000000000"
      ],
      contract: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      address: this.config.circleWalletAddress,
      chain: this.config.chain
    });

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `createJob-${Date.now()}`,
      agentId: this.config.agentId,
      request: body,
      response: result,
      proof: {
        circleCommand: [result.command, ...result.args].join(" "),
        sha256: sha256Json(result),
        txHash: extractPossibleTxHash(result)
      }
    });

    return { ok: true, result, receipt };
  }

  /**
   * Set budget for an ERC-8183 job.
   * Signature: setBudget(jobId, amount, optParams)
   */
  async setBudget(body: unknown) {
    const input = body as { jobId: string; amount: string; optParams?: string };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    const result = await this.circle.executeErc8183Write({
      signature: "setBudget(uint256,uint256,bytes)",
      params: [input.jobId, input.amount, input.optParams ?? "0x"],
      contract: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      address: this.config.circleWalletAddress,
      chain: this.config.chain
    });

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `setBudget-${input.jobId}`,
      jobId: input.jobId,
      agentId: this.config.agentId,
      request: body,
      response: result,
      proof: {
        sha256: sha256Json(result),
        txHash: extractPossibleTxHash(result)
      }
    });

    return { ok: true, result, receipt };
  }

  /**
   * Approve USDC for the ERC-8183 AgenticCommerce contract.
   * Must be called before fund().
   */
  async approveUsdcForErc8183(body: unknown) {
    const input = body as { amount: string };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    const result = await this.circle.approveUsdc({
      amount: input.amount,
      usdcAddress: CONTRACTS.USDC,
      spenderAddress: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      walletAddress: this.config.circleWalletAddress,
      chain: this.config.chain
    });

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `approve-${Date.now()}`,
      agentId: this.config.agentId,
      request: body,
      response: result,
      proof: {
        sha256: sha256Json(result),
        txHash: extractPossibleTxHash(result)
      }
    });

    return { ok: true, result, receipt };
  }

  /**
   * Fund an ERC-8183 job.
   * Signature: fund(jobId, optParams)
   * Requires prior USDC approve.
   */
  async fundJob(body: unknown) {
    const input = body as { jobId: string; optParams?: string };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    const result = await this.circle.executeErc8183Write({
      signature: "fund(uint256,bytes)",
      params: [input.jobId, input.optParams ?? "0x"],
      contract: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      address: this.config.circleWalletAddress,
      chain: this.config.chain
    });

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `fund-${input.jobId}`,
      jobId: input.jobId,
      agentId: this.config.agentId,
      request: body,
      response: result,
      proof: {
        sha256: sha256Json(result),
        txHash: extractPossibleTxHash(result)
      }
    });

    return { ok: true, result, receipt };
  }

  /**
   * Complete an ERC-8183 job (evaluator action).
   * Signature: complete(jobId, reason, optParams)
   * reason is bytes32 — strings are keccak256-hashed.
   */
  async completeJob(body: unknown) {
    const input = body as { jobId: string; reason: string; optParams?: string };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    const reasonHash = input.reason.startsWith("0x") && input.reason.length === 66
      ? input.reason
      : erc8183Hash(input.reason);

    const result = await this.circle.executeErc8183Write({
      signature: "complete(uint256,bytes32,bytes)",
      params: [input.jobId, reasonHash, input.optParams ?? "0x"],
      contract: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      address: this.config.circleWalletAddress,
      chain: this.config.chain
    });

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `complete-${input.jobId}`,
      jobId: input.jobId,
      agentId: this.config.agentId,
      request: body,
      response: result,
      proof: {
        sha256: sha256Json(result),
        txHash: extractPossibleTxHash(result)
      }
    });

    return { ok: true, result, receipt };
  }

  /**
   * Reject an ERC-8183 job (evaluator action).
   * Signature: reject(jobId, reason, optParams)
   * reason is bytes32 — strings are keccak256-hashed.
   */
  async rejectJob(body: unknown) {
    const input = body as { jobId: string; reason: string; optParams?: string };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    const reasonHash = input.reason.startsWith("0x") && input.reason.length === 66
      ? input.reason
      : erc8183Hash(input.reason);

    const result = await this.circle.executeErc8183Write({
      signature: "reject(uint256,bytes32,bytes)",
      params: [input.jobId, reasonHash, input.optParams ?? "0x"],
      contract: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      address: this.config.circleWalletAddress,
      chain: this.config.chain
    });

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `reject-${input.jobId}`,
      jobId: input.jobId,
      agentId: this.config.agentId,
      request: body,
      response: result,
      proof: {
        sha256: sha256Json(result),
        txHash: extractPossibleTxHash(result)
      }
    });

    return { ok: true, result, receipt };
  }

  /**
   * Gateway deposit — gated behind allowGatewayDeposit config flag.
   * Disabled by default. Only for devops-admin role.
   */
  async gatewayDeposit(body: unknown) {
    if (!this.config.allowGatewayDeposit) {
      throw new RunnerError(
        "GATEWAY_DEPOSIT_DISABLED",
        "Gateway deposit is disabled. Set allowGatewayDeposit=true to enable.",
        403
      );
    }

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    const input = body as { amount: string; method?: string };

    const result = await this.circle.gatewayDeposit({
      amount: input.amount,
      address: this.config.circleWalletAddress,
      chain: this.config.chain,
      method: input.method
    });

    const receipt = await this.receipts.append({
      type: "circle_status",
      agentId: this.config.agentId,
      request: body,
      response: result,
      proof: {
        sha256: sha256Json(result),
        txHash: extractPossibleTxHash(result)
      }
    });

    return { ok: true, result, receipt };
  }

  /**
   * Register ERC-8004 identity via Circle CLI.
   * Gated behind allowIdentityRegister config flag.
   * Verifies tx receipt + ownerOf(tokenId) == configured wallet.
   */
  async registerIdentityViaCircleCli(body: unknown) {
    if (!this.config.allowIdentityRegister) {
      throw new RunnerError(
        "IDENTITY_REGISTER_DISABLED",
        "Identity register via Circle CLI is disabled. Set allowIdentityRegister=true to enable.",
        403
      );
    }

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    const input = body as { metadataURI: string };
    if (!input.metadataURI) {
      throw new RunnerError("MISSING_FIELD", "metadataURI is required", 400);
    }

    // Execute register(string) on IdentityRegistry
    const result = await this.circle.executeAllowedArcWrite({
      signature: "register(string)",
      params: [input.metadataURI],
      contract: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
      address: this.config.circleWalletAddress,
      chain: this.config.chain,
      allowRegister: true
    });

    // Extract txHash from result
    const txHash = extractPossibleTxHash(result);

    // Verify ownership if txHash exists
    let ownershipVerified = false;
    if (txHash) {
      try {
        // Query ownerOf(tokenId) — but we don't know tokenId from register output
        // The CLI result should contain the tokenId
        const json = result.json as any;
        const tokenId = json?.tokenId ?? json?.outputs?.[0];
        if (tokenId) {
          const ownerResult = await this.circle.queryContract({
            signature: "ownerOf(uint256)",
            params: [String(tokenId)],
            contract: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
            chain: this.config.chain
          });
          const ownerJson = ownerResult.json as any;
          const owner = (ownerJson?.outputs?.[0] ?? ownerJson?.result ?? "").toString().toLowerCase();
          ownershipVerified = owner === this.config.circleWalletAddress.toLowerCase();
        }
      } catch {
        // Ownership check failed — not blocking, just flag
      }
    }

    const receipt = await this.receipts.append({
      type: "erc8004_prepare_register",
      taskId: `register-${Date.now()}`,
      agentId: this.config.agentId,
      request: body,
      response: { ...result, ownershipVerified },
      proof: {
        sha256: sha256Json(result),
        txHash
      }
    });

    return { ok: true, result, txHash, ownershipVerified, receipt };
  }

  /**
   * Inspect an x402 service (read-only, no payment).
   * Only requires URL validation and host allowlist.
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
   */
  async payX402(body: unknown) {
    const payment = PaymentRequestSchema.parse(body);
    assertX402PaymentAllowed(this.config, payment);

    const idempotencyKey = payment.idempotencyKey ?? randomUUID();

    return withKeyLock(idempotencyKey, async () => {
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

      const pending = await this.ledger.hasPendingAttempt(idempotencyKey);
      if (pending) {
        throw new RunnerError(
          "PAYMENT_IN_PROGRESS",
          `Payment with idempotencyKey ${idempotencyKey} is already in progress`,
          409
        );
      }

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

  async batchPayX402(body: unknown) {
    const batch = BatchPaymentRequestSchema.parse(body);

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
