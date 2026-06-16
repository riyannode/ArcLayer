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
  assertSubmittableRuntimeResult,
  decimalToMicros,
  erc8183Hash,
  sha256Json,
  sha256Text,
  RunnerError,
  type RunnerConfig,
  type RuntimeResult
} from "@arclayer/runner-core";
import { CircleCliAdapter } from "@arclayer/circle-cli-adapter";
import { CONTRACTS } from "@arclayer/sdk";
import type { RuntimeConnector } from "./runtime";
import { safeHostFromUrl, sanitizeTaskForUntrustedRuntime } from "./runtime";
import type { ArcLayerMcpConnector } from "./mcp-connector";
import { isBrokerAbortOrTimeout } from "./mcp-broker";
import { randomUUID } from "node:crypto";
import { ExecutionGateway, assertGatewayWriteSucceeded } from "./execution-gateway";
import type { WriteOperationKind } from "./execution-gateway";
import { ApprovalManager } from "./approval-manager";

// ── Canonical Helpers ──────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Preflight: verify Console sync endpoint accepts our Bearer token. */
async function verifyConsoleSyncAuth(
  syncUrl: string,
  syncSecret: string,
  controllerAddress: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; errorCode: string; reason: string }> {
  try {
    const response = await fetch(syncUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${syncSecret}`,
      },
      body: JSON.stringify({ txHash: "bad", controllerAddress, role: "provider" }),
      signal,
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.status === 400 && json.error === "invalid_txHash") {
      return { ok: true };
    }
    return {
      ok: false,
      errorCode: "sync_auth_preflight_failed",
      reason: `Console sync auth preflight failed: status=${response.status}, error=${String(json.error ?? "unknown")}`,
    };
  } catch (err) {
    return {
      ok: false,
      errorCode: "sync_auth_preflight_failed",
      reason: `Console sync auth preflight failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Map config.chain string to numeric chainId for approval validation. */
function resolveChainId(chain: string): number {
  const normalized = chain.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "arc" || normalized === "arctestnet" || normalized === "5042002") {
    return 5042002;
  }
  // Fallback: try parsing as number directly
  const parsed = Number(chain);
  if (!isNaN(parsed) && parsed > 0) return parsed;
  // Default to Arc Testnet
  return 5042002;
}

function canonicalAddress(value: string | undefined, fallback = ZERO_ADDRESS): string {
  const raw = value ?? fallback;
  return raw.toLowerCase();
}

function canonicalExpiredAt(value: string | number): string {
  return String(value);
}

function stableRequestKey(
  prefix: string,
  input: { idempotencyKey?: string; requestId?: string },
  fallback: string
): string {
  if (input.idempotencyKey) return input.idempotencyKey;
  if (input.requestId) return `${prefix}:${input.requestId}`;
  return fallback;
}

/**
 * Task lifecycle callbacks — called AFTER validation passes.
 * Router passes these; service methods invoke them at the right moment.
 */
export type TaskLifecycle = {
  reserveTaskId?: (taskId: string, agentId: string) => void;
  markTaskCompleted?: (taskId: string, agentId: string) => void;
  markTaskFailed?: (taskId: string, agentId: string) => void;
};

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
  /** @private — owned by ExecutionGateway. Use gateway.execute() for writes. */
  private readonly circle: CircleCliAdapter;
  readonly gateway: ExecutionGateway;
  readonly approvalManager: ApprovalManager;

  constructor(
    readonly config: RunnerConfig,
    readonly runtime: RuntimeConnector,
    readonly mcp: ArcLayerMcpConnector,
    readonly skill: { content: string; sha256: string; path: string }
  ) {
    this.receipts = new JsonlReceiptStore(config.dataDir);
    this.ledger = new SpendingLedger(config.dataDir);
    this.circle = new CircleCliAdapter({ bin: config.circleCliBin });
    this.gateway = new ExecutionGateway(this.circle, this.receipts, {
      agentId: config.agentId,
      circleWalletAddress: config.circleWalletAddress,
      chain: config.chain,
      dataDir: config.dataDir,
    });
    this.approvalManager = new ApprovalManager(
      this,
      config.dataDir,
      resolveChainId(config.chain),
      config.circleWalletAddress,
    );
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

  async runGeneric(body: unknown, lifecycle?: TaskLifecycle) {
    const task = AgentTaskSchema.parse(body);
    assertAgentIdentity(this.config, task.agentId);
    assertRoleAllowed(this.config, task.role);
    assertProviderOnlyForExternal(this.config, task.role);

    // Reserve taskId AFTER all validation passes — before dispatch
    lifecycle?.reserveTaskId?.(task.taskId, task.agentId);

    const startTime = Date.now();

    try {
      const result = await this.runtime.run(task);
      const durationMs = Date.now() - startTime;
      lifecycle?.markTaskCompleted?.(task.taskId, task.agentId);

      const isOpenClaw = this.runtime.kind === "openclaw";
      const receiptRequest = isOpenClaw ? sanitizeTaskForUntrustedRuntime(task) : task;

      const receipt = await this.receipts.append({
        type: "runtime_result",
        taskId: task.taskId,
        agentId: task.agentId,
        request: receiptRequest,
        response: result,
        proof: {
          sha256: sha256Json(result),
          runtimeKind: this.runtime.kind,
          durationMs,
          responseHash: sha256Json(result),
          sanitized: isOpenClaw,
          responseValidated: true,
          endpointHost: safeHostFromUrl(this.config.runtimeEndpoint),
        }
      });

      return { ok: true, result, receipt };
    } catch (error) {
      lifecycle?.markTaskFailed?.(task.taskId, task.agentId);
      throw error;
    }
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

  async runProviderJob(body: unknown, lifecycle?: TaskLifecycle) {
    const job = Erc8183ProviderJobSchema.parse(body);
    assertAgentIdentity(this.config, job.agentId);
    assertRoleAllowed(this.config, "provider");
    assertProviderOnlyForExternal(this.config, "provider");

    // Reserve taskId AFTER all validation passes — before dispatch
    lifecycle?.reserveTaskId?.(job.taskId, job.agentId);

    try {
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

      // Step 3: Check runtime result — only completed results are hashable
      if (!result.ok || result.status === "failed") {
        await this.mcp.writeCheckpoint(job.jobId, {
          status: "failed",
          error: result.error ?? "Runtime returned failure"
        }).catch(() => {});

        lifecycle?.markTaskFailed?.(job.taskId, job.agentId);
        return {
          ok: false,
          status: "runtime_failure",
          role: "provider",
          result,
          error: result.error ?? "Runtime returned ok=false or status=failed"
        };
      }

      // Step 4: For non-completed statuses (needs_payment, needs_action),
      // write checkpoint so hosted run state is recoverable, then return
      if (result.status !== "completed") {
        await this.mcp.writeCheckpoint(job.jobId, {
          status: result.status,
          paymentRequests: result.paymentRequests,
          actionRequests: result.actionRequests
        }).catch(() => {});

        lifecycle?.markTaskCompleted?.(job.taskId, job.agentId);
        return {
          ok: false,
          status: result.status,
          role: "provider",
          result,
          error: `Runtime returned non-completed status: ${result.status}`
        };
      }

      // Step 5: Hash deliverable — but do NOT submit on-chain
      const deliverableHash = erc8183Hash(result.output ?? result);

      // Step 6: Store runtime receipt — durable evidence of request + output + hash.
      // Do NOT call completeJobRun here; that is terminal cleanup reserved for
      // the submit step (runAndSubmitProviderJob / submitProviderDeliverable).
      // Keeping the hosted run active preserves resumable job state.
      const isOpenClaw = this.runtime.kind === "openclaw";
      const receiptRequest = isOpenClaw ? sanitizeTaskForUntrustedRuntime({
        taskId: job.taskId,
        protocol: "erc8183",
        role: "provider",
        agentId: job.agentId,
        input: job.input,
        metadata: { jobId: job.jobId, provider: job.provider, evaluator: job.evaluator, description: job.description }
      }) : { jobId: job.jobId, provider: job.provider, description: job.description };

      const receipt = await this.receipts.append({
        type: "runtime_result",
        taskId: job.taskId,
        jobId: job.jobId,
        agentId: job.agentId,
        request: receiptRequest,
        response: result,
        proof: {
          sha256: sha256Json(result),
          deliverableHash,
          runtimeKind: this.runtime.kind,
          sanitized: isOpenClaw,
          endpointHost: safeHostFromUrl(this.config.runtimeEndpoint),
        }
      });

      lifecycle?.markTaskCompleted?.(job.taskId, job.agentId);
      return {
        ok: true,
        status: "completed",
        role: "provider",
        result,
        deliverableHash,
        runId,
        receipt
      };

    } catch (error) {
      lifecycle?.markTaskFailed?.(job.taskId, job.agentId);
      throw error;
    }
  }

  async submitProviderDeliverable(
    input: {
      jobId: string;
      deliverableHash: `0x${string}`;
      result: RuntimeResult;
      optParams?: `0x${string}`;
    },
    signal?: AbortSignal
  ) {
    // Validate jobId
    if (!input.jobId || !/^[0-9]+$/.test(input.jobId)) {
      throw new RunnerError("INVALID_JOB_ID", "jobId must be a numeric string", 400);
    }

    // Validate deliverableHash bytes32
    if (!input.deliverableHash || !/^0x[a-fA-F0-9]{64}$/.test(input.deliverableHash)) {
      throw new RunnerError("INVALID_DELIVERABLE_HASH", "deliverableHash must be a valid bytes32 hex string", 400);
    }

    // Validate runtime result is submittable (only completed passes)
    assertSubmittableRuntimeResult(input.result);

    // MCP prepare/preflight — validates deliverable before on-chain submit.
    // Runs before circleWalletAddress check so prepared-only responses
    // can still include preparedTx (matches old runErc8183ProviderJob flow).
    const preparedTx = await this.mcp.prepareSubmitDeliverable(
      input.jobId,
      input.deliverableHash
    ).catch((err) => {
      console.warn(`[runner] MCP prepareSubmitDeliverable failed: ${err.message}`);
      return null;
    });

    // Verify provider address is configured
    if (!this.config.circleWalletAddress) {
      return {
        ok: false,
        mode: "prepared-only",
        reason: "CIRCLE_WALLET_ADDRESS not configured",
        preparedTx,
        prepared: input
      };
    }

    // Call Circle CLI submit — only place this is allowed
    const submitReceipt = await this.submitDeliverableViaCircleCli({
      jobId: input.jobId,
      deliverableHash: input.deliverableHash,
      optParams: input.optParams ?? "0x"
    }, signal);

    // If submit was prepared-only (no contract/wallet), return failure
    if (submitReceipt && typeof submitReceipt === "object" && "ok" in submitReceipt && !submitReceipt.ok) {
      return {
        ok: false,
        status: "prepared-only",
        deliverableHash: input.deliverableHash,
        preparedTx,
        submitReceipt,
        error: submitReceipt.reason ?? "On-chain submit not available"
      };
    }

    // Store receipt with proof — preserve runtime result for audit linkage.
    // Include gateway metadata (operationId, idempotent) so receipt/history
    // consumers can distinguish replays from fresh writes.
    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      jobId: input.jobId,
      agentId: this.config.agentId,
      request: { jobId: input.jobId, deliverableHash: input.deliverableHash },
      response: { result: input.result, preparedTx, submitReceipt },
      proof: {
        deliverableHash: input.deliverableHash,
        sha256: sha256Json({ result: input.result, preparedTx, submitReceipt }),
        txHash: extractPossibleTxHash(submitReceipt),
        operationId: submitReceipt?.operationId,
        idempotent: submitReceipt?.idempotent,
      }
    });

    return {
      ok: true,
      deliverableHash: input.deliverableHash,
      preparedTx,
      submitReceipt,
      receipt
    };
  }

  async runAndSubmitProviderJob(body: unknown, lifecycle?: TaskLifecycle, signal?: AbortSignal) {
    // Step 1: Run runtime only (no on-chain submit)
    const runResult = await this.runProviderJob(body, lifecycle);

    // Step 2: If runtime did not complete, return without submitting
    if (!runResult.ok || runResult.status !== "completed") {
      return runResult;
    }

    // Step 3: Submit deliverable on-chain
    // After the guard above, runResult is the completed branch with deliverableHash
    const job = Erc8183ProviderJobSchema.parse(body);
    const submitResult = await this.submitProviderDeliverable({
      jobId: job.jobId,
      deliverableHash: runResult.deliverableHash as `0x${string}`,
      result: runResult.result as RuntimeResult,
      optParams: "0x"
    }, signal);

    // Step 4: Propagate submit failure — do not mask with ok:true from runtime
    if (!submitResult.ok) {
      return {
        ok: false,
        status: "submit_failure",
        role: "provider" as const,
        result: runResult.result,
        deliverableHash: runResult.deliverableHash,
        submitReceipt: submitResult.submitReceipt,
        error: submitResult.error ?? "On-chain submit failed"
      };
    }

    // Step 5: Submit succeeded — now complete the hosted MCP run (terminal cleanup)
    await this.mcp.completeJobRun(job.jobId, runResult.result.output, runResult.runId).catch((err) => {
      console.warn(`[runner] MCP completeJobRun failed: ${err.message}`);
    });

    return {
      ok: true,
      status: "completed",
      role: "provider" as const,
      result: runResult.result,
      deliverableHash: runResult.deliverableHash,
      runId: runResult.runId,
      submitReceipt: submitResult.submitReceipt,
      receipt: submitResult.receipt
    };
  }

  async runErc8183ProviderJob(body: unknown, lifecycle?: TaskLifecycle) {
    // Backward-compat wrapper: delegates to runAndSubmitProviderJob
    // which splits runtime execution from on-chain submission.
    return this.runAndSubmitProviderJob(body, lifecycle);
  }

  async submitDeliverableViaCircleCli(
    input: {
      jobId: string;
      deliverableHash: `0x${string}`;
      optParams?: `0x${string}`;
    },
    signal?: AbortSignal
  ) {
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

    const normalizedOptParams = input.optParams ?? "0x";
    const idempotencyKey = `submitDeliverable:${input.jobId}:${input.deliverableHash}`;
    const paramsHash = sha256Json({ jobId: input.jobId, deliverableHash: input.deliverableHash, optParams: normalizedOptParams });

    const gwResult = await this.gateway.execute(
      {
        kind: "submitDeliverable" as WriteOperationKind,
        idempotencyKey,
        paramsHash,
        walletAddress: this.config.circleWalletAddress,
        chain: this.config.chain,
        contractAddress,
        jobId: input.jobId,
      },
      async (circle, sig) => circle.executeErc8183Write({
        signature: "submit(uint256,bytes32,bytes)",
        params: [input.jobId, input.deliverableHash, input.optParams ?? "0x"],
        contract: contractAddress,
        address: this.config.circleWalletAddress!,
        chain: this.config.chain,
        signal: sig,
      }),
      signal
    );

    assertGatewayWriteSucceeded(gwResult);

    return {
      ok: true,
      ...(gwResult.circleResult ?? {}),
      operationId: gwResult.operationId,
      state: gwResult.state,
      idempotent: gwResult.idempotent,
    };
  }

  // ── ERC-8183 Full Lifecycle ──────────────────────────────────────────────

  /**
   * Create a new ERC-8183 job on-chain.
   * Signature: createJob(provider, evaluator, expiredAt, description, hook)
   * hook is an address (not bytes) — the callback contract.
   */
  async createJob(body: unknown, signal?: AbortSignal) {
    const input = body as {
      provider: string;
      evaluator: string;
      expiredAt: string | number;
      description: string;
      hook?: string;
      idempotencyKey?: string;
      requestId?: string;
    };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    // Arc/Circle spec: createJob reverts if evaluator is zero address
    if (!input.evaluator || input.evaluator.toLowerCase() === ZERO_ADDRESS) {
      throw new RunnerError(
        "INVALID_EVALUATOR",
        "evaluator must be non-zero (Arc spec: createJob reverts with zero evaluator)",
        400
      );
    }

    // Validate expiredAt is in the future
    const expiredAtNum = Number(input.expiredAt);
    if (isNaN(expiredAtNum) || expiredAtNum <= 0) {
      throw new RunnerError(
        "INVALID_EXPIRED_AT",
        "expiredAt must be a valid positive unix timestamp",
        400
      );
    }
    const nowUnix = Math.floor(Date.now() / 1000);
    if (expiredAtNum <= nowUnix) {
      throw new RunnerError(
        "INVALID_EXPIRED_AT",
        `expiredAt (${expiredAtNum}) must be in the future (now: ${nowUnix})`,
        400
      );
    }

    const normalizedProvider = canonicalAddress(input.provider);
    const normalizedEvaluator = canonicalAddress(input.evaluator);
    const normalizedHook = canonicalAddress(input.hook);
    const normalizedExpiredAt = canonicalExpiredAt(input.expiredAt);

    const fallbackIdempotencyKey =
      `createJob:${normalizedProvider}:${normalizedEvaluator}:${normalizedExpiredAt}:${input.description}:${normalizedHook}`;

    const idempotencyKey = stableRequestKey("createJob", input, fallbackIdempotencyKey);

    const paramsHash = sha256Json({
      provider: normalizedProvider,
      evaluator: normalizedEvaluator,
      expiredAt: normalizedExpiredAt,
      description: input.description,
      hook: normalizedHook,
    });

    const gwResult = await this.gateway.execute(
      {
        kind: "createJob" as WriteOperationKind,
        idempotencyKey,
        paramsHash,
        walletAddress: this.config.circleWalletAddress,
        chain: this.config.chain,
        contractAddress: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      },
      async (circle, sig) => circle.executeErc8183Write({
        signature: "createJob(address,address,uint256,string,address)",
        params: [
          normalizedProvider,
          normalizedEvaluator,
          normalizedExpiredAt,
          input.description,
          normalizedHook,
        ],
        contract: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        address: this.config.circleWalletAddress!,
        chain: this.config.chain,
        signal: sig,
      }),
      signal
    );

    assertGatewayWriteSucceeded(gwResult);

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `createJob-${Date.now()}`,
      agentId: this.config.agentId,
      request: body,
      response: gwResult.circleResult ?? gwResult,
      proof: {
        sha256: sha256Json(gwResult.circleResult ?? gwResult),
        txHash: gwResult.txHash,
        operationId: gwResult.operationId,
        operationState: gwResult.state,
        idempotent: gwResult.idempotent,
      }
    });

    return { ok: gwResult.ok, txHash: gwResult.txHash, result: gwResult.circleResult, receipt, operationId: gwResult.operationId, idempotent: gwResult.idempotent };
  }

  /**
   * Set budget for an ERC-8183 job.
   * Signature: setBudget(jobId, amount, optParams)
   */
  async setBudget(body: unknown, signal?: AbortSignal) {
    const input = body as { jobId: string; amount: string; optParams?: string };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    const normalizedOptParams = input.optParams ?? "0x";
    const idempotencyKey = `setBudget:${input.jobId}:${input.amount}`;
    const paramsHash = sha256Json({ jobId: input.jobId, amount: input.amount, optParams: normalizedOptParams });

    // Convert USDC decimal to micros (uint256) for on-chain call
    const amountMicros = decimalToMicros(input.amount).toString();

    const gwResult = await this.gateway.execute(
      {
        kind: "setBudget" as WriteOperationKind,
        idempotencyKey,
        paramsHash,
        walletAddress: this.config.circleWalletAddress,
        chain: this.config.chain,
        contractAddress: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        jobId: input.jobId,
      },
      async (circle, sig) => circle.executeErc8183Write({
        signature: "setBudget(uint256,uint256,bytes)",
        params: [input.jobId, amountMicros, input.optParams ?? "0x"],
        contract: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        address: this.config.circleWalletAddress!,
        chain: this.config.chain,
        signal: sig,
      }),
      signal
    );

    assertGatewayWriteSucceeded(gwResult);

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `setBudget-${input.jobId}`,
      jobId: input.jobId,
      agentId: this.config.agentId,
      request: body,
      response: gwResult.circleResult ?? gwResult,
      proof: {
        sha256: sha256Json(gwResult.circleResult ?? gwResult),
        txHash: gwResult.txHash,
        operationId: gwResult.operationId,
        operationState: gwResult.state,
        idempotent: gwResult.idempotent,
      }
    });

    return { ok: gwResult.ok, txHash: gwResult.txHash, result: gwResult.circleResult, receipt, operationId: gwResult.operationId, idempotent: gwResult.idempotent };
  }

  /**
   * Approve USDC for the ERC-8183 AgenticCommerce contract.
   * Must be called before fund().
   *
   * Idempotency: caller SHOULD provide a stable idempotencyKey (e.g. tied to
   * the jobId or request that needs the allowance). If omitted, a key is
   * derived from amount+spender — safe for single-use but does NOT protect
   * retries after unknown/broadcast if the server restarts.
   */
  async approveUsdcForErc8183(body: unknown, signal?: AbortSignal) {
    const input = body as {
      amount: string;
      /** Caller-provided stable key for retry safety. */
      idempotencyKey?: string;
      /** Optional context for key derivation when idempotencyKey is omitted. */
      requestId?: string;
    };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    // Stable idempotency key: prefer caller-provided, then derive from context.
    // TODO: callers in the job lifecycle (setBudget→approve→fund) should pass
    // a jobId-derived key so retries after unknown/broadcast are safe.
    const idempotencyKey = input.idempotencyKey
      ?? (input.requestId
        ? `approveUsdc:${input.requestId}:${input.amount}`
        : `approveUsdc:${input.amount}:${CONTRACTS.ERC8183_AGENTIC_COMMERCE}`);
    const paramsHash = sha256Json({ amount: input.amount, usdcAddress: CONTRACTS.USDC, spenderAddress: CONTRACTS.ERC8183_AGENTIC_COMMERCE });

    const gwResult = await this.gateway.execute(
      {
        kind: "approveUsdc" as WriteOperationKind,
        idempotencyKey,
        paramsHash,
        walletAddress: this.config.circleWalletAddress,
        chain: this.config.chain,
        contractAddress: CONTRACTS.USDC,
      },
      async (circle, sig) => circle.approveUsdc({
        amount: input.amount,
        usdcAddress: CONTRACTS.USDC,
        spenderAddress: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        walletAddress: this.config.circleWalletAddress!,
        chain: this.config.chain,
        signal: sig,
      }),
      signal
    );

    assertGatewayWriteSucceeded(gwResult);

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `approve-${Date.now()}`,
      agentId: this.config.agentId,
      request: body,
      response: gwResult.circleResult ?? gwResult,
      proof: {
        sha256: sha256Json(gwResult.circleResult ?? gwResult),
        txHash: gwResult.txHash,
        operationId: gwResult.operationId,
        operationState: gwResult.state,
        idempotent: gwResult.idempotent,
      }
    });

    return { ok: gwResult.ok, txHash: gwResult.txHash, result: gwResult.circleResult, receipt, operationId: gwResult.operationId, idempotent: gwResult.idempotent };
  }

  /**
   * Fund an ERC-8183 job.
   * Signature: fund(jobId, optParams)
   * Requires prior USDC approve.
   */
  async fundJob(body: unknown, signal?: AbortSignal) {
    const input = body as { jobId: string; optParams?: string };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    const normalizedOptParams = input.optParams ?? "0x";
    const idempotencyKey = `fundJob:${input.jobId}`;
    const paramsHash = sha256Json({ jobId: input.jobId, optParams: normalizedOptParams });

    const gwResult = await this.gateway.execute(
      {
        kind: "fundJob" as WriteOperationKind,
        idempotencyKey,
        paramsHash,
        walletAddress: this.config.circleWalletAddress,
        chain: this.config.chain,
        contractAddress: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        jobId: input.jobId,
      },
      async (circle, sig) => circle.executeErc8183Write({
        signature: "fund(uint256,bytes)",
        params: [input.jobId, input.optParams ?? "0x"],
        contract: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        address: this.config.circleWalletAddress!,
        chain: this.config.chain,
        signal: sig,
      }),
      signal
    );

    assertGatewayWriteSucceeded(gwResult);

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `fund-${input.jobId}`,
      jobId: input.jobId,
      agentId: this.config.agentId,
      request: body,
      response: gwResult.circleResult ?? gwResult,
      proof: {
        sha256: sha256Json(gwResult.circleResult ?? gwResult),
        txHash: gwResult.txHash,
        operationId: gwResult.operationId,
        operationState: gwResult.state,
        idempotent: gwResult.idempotent,
      }
    });

    return { ok: gwResult.ok, txHash: gwResult.txHash, result: gwResult.circleResult, receipt, operationId: gwResult.operationId, idempotent: gwResult.idempotent };
  }

  /**
   * Complete an ERC-8183 job (evaluator action).
   * Signature: complete(jobId, reason, optParams)
   * reason is bytes32 — strings are keccak256-hashed.
   */
  async completeJob(body: unknown, signal?: AbortSignal) {
    const input = body as { jobId: string; reason: string; optParams?: string };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    const reasonHash = input.reason.startsWith("0x") && input.reason.length === 66
      ? input.reason
      : erc8183Hash(input.reason);

    const normalizedOptParams = input.optParams ?? "0x";
    const idempotencyKey = `completeJob:${input.jobId}:${reasonHash}`;
    const paramsHash = sha256Json({ jobId: input.jobId, reasonHash, optParams: normalizedOptParams });

    const gwResult = await this.gateway.execute(
      {
        kind: "completeJob" as WriteOperationKind,
        idempotencyKey,
        paramsHash,
        walletAddress: this.config.circleWalletAddress,
        chain: this.config.chain,
        contractAddress: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        jobId: input.jobId,
      },
      async (circle, sig) => circle.executeErc8183Write({
        signature: "complete(uint256,bytes32,bytes)",
        params: [input.jobId, reasonHash, input.optParams ?? "0x"],
        contract: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        address: this.config.circleWalletAddress!,
        chain: this.config.chain,
        signal: sig,
      }),
      signal
    );

    assertGatewayWriteSucceeded(gwResult);

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `complete-${input.jobId}`,
      jobId: input.jobId,
      agentId: this.config.agentId,
      request: body,
      response: gwResult.circleResult ?? gwResult,
      proof: {
        sha256: sha256Json(gwResult.circleResult ?? gwResult),
        txHash: gwResult.txHash,
        operationId: gwResult.operationId,
        operationState: gwResult.state,
        idempotent: gwResult.idempotent,
      }
    });

    return { ok: gwResult.ok, txHash: gwResult.txHash, result: gwResult.circleResult, receipt, operationId: gwResult.operationId, idempotent: gwResult.idempotent };
  }

  /**
   * Reject an ERC-8183 job (evaluator action).
   * Signature: reject(jobId, reason, optParams)
   * reason is bytes32 — strings are keccak256-hashed.
   */
  async rejectJob(body: unknown, signal?: AbortSignal) {
    const input = body as { jobId: string; reason: string; optParams?: string };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    const reasonHash = input.reason.startsWith("0x") && input.reason.length === 66
      ? input.reason
      : erc8183Hash(input.reason);

    const normalizedOptParams = input.optParams ?? "0x";
    const idempotencyKey = `rejectJob:${input.jobId}:${reasonHash}`;
    const paramsHash = sha256Json({ jobId: input.jobId, reasonHash, optParams: normalizedOptParams });

    const gwResult = await this.gateway.execute(
      {
        kind: "rejectJob" as WriteOperationKind,
        idempotencyKey,
        paramsHash,
        walletAddress: this.config.circleWalletAddress,
        chain: this.config.chain,
        contractAddress: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        jobId: input.jobId,
      },
      async (circle, sig) => circle.executeErc8183Write({
        signature: "reject(uint256,bytes32,bytes)",
        params: [input.jobId, reasonHash, input.optParams ?? "0x"],
        contract: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        address: this.config.circleWalletAddress!,
        chain: this.config.chain,
        signal: sig,
      }),
      signal
    );

    assertGatewayWriteSucceeded(gwResult);

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `reject-${input.jobId}`,
      jobId: input.jobId,
      agentId: this.config.agentId,
      request: body,
      response: gwResult.circleResult ?? gwResult,
      proof: {
        sha256: sha256Json(gwResult.circleResult ?? gwResult),
        txHash: gwResult.txHash,
        operationId: gwResult.operationId,
        operationState: gwResult.state,
        idempotent: gwResult.idempotent,
      }
    });

    return { ok: gwResult.ok, txHash: gwResult.txHash, result: gwResult.circleResult, receipt, operationId: gwResult.operationId, idempotent: gwResult.idempotent };
  }

  /**
   * Claim refund for an expired ERC-8183 job.
   * Signature: claimRefund(uint256 jobId) — single arg, NO optParams.
   * Caller: client (job creator). Job must be expired.
   */
  async claimRefund(body: unknown, signal?: AbortSignal) {
    const input = body as { jobId: string };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    const idempotencyKey = `claimRefund:${input.jobId}`;
    const paramsHash = sha256Json({ jobId: input.jobId });

    const gwResult = await this.gateway.execute(
      {
        kind: "claimRefund" as WriteOperationKind,
        idempotencyKey,
        paramsHash,
        walletAddress: this.config.circleWalletAddress,
        chain: this.config.chain,
        contractAddress: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        jobId: input.jobId,
      },
      async (circle, sig) => circle.executeErc8183Write({
        signature: "claimRefund(uint256)",
        params: [input.jobId],
        contract: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        address: this.config.circleWalletAddress!,
        chain: this.config.chain,
        signal: sig,
      }),
      signal
    );

    assertGatewayWriteSucceeded(gwResult);

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `claimRefund-${input.jobId}`,
      jobId: input.jobId,
      agentId: this.config.agentId,
      request: body,
      response: gwResult.circleResult ?? gwResult,
      proof: {
        sha256: sha256Json(gwResult.circleResult ?? gwResult),
        txHash: gwResult.txHash,
        operationId: gwResult.operationId,
        operationState: gwResult.state,
        idempotent: gwResult.idempotent,
      }
    });

    return { ok: gwResult.ok, txHash: gwResult.txHash, result: gwResult.circleResult, receipt, operationId: gwResult.operationId, idempotent: gwResult.idempotent };
  }

  /**
   * Set provider on an open ERC-8183 job.
   * Signature: setProvider(uint256 jobId, address provider_)
   * Caller: client (job creator). Job must be Open, current provider must be 0x0.
   */
  async setProvider(body: unknown, signal?: AbortSignal) {
    const input = body as { jobId: string; provider: string };

    if (!this.config.circleWalletAddress) {
      return { ok: false, mode: "prepared-only", reason: "CIRCLE_WALLET_ADDRESS not configured" };
    }

    // Validate provider is non-zero (assigning zero provider doesn't make sense)
    const ZERO = "0x0000000000000000000000000000000000000000";
    if (!input.provider || input.provider.toLowerCase() === ZERO) {
      throw new RunnerError(
        "INVALID_PROVIDER",
        "provider must be non-zero address",
        400
      );
    }

    const idempotencyKey = `setProvider:${input.jobId}:${input.provider}`;
    const paramsHash = sha256Json({ jobId: input.jobId, provider: input.provider });

    const gwResult = await this.gateway.execute(
      {
        kind: "setProvider" as WriteOperationKind,
        idempotencyKey,
        paramsHash,
        walletAddress: this.config.circleWalletAddress,
        chain: this.config.chain,
        contractAddress: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        jobId: input.jobId,
      },
      async (circle, sig) => circle.executeErc8183Write({
        signature: "setProvider(uint256,address)",
        params: [input.jobId, input.provider],
        contract: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        address: this.config.circleWalletAddress!,
        chain: this.config.chain,
        signal: sig,
      }),
      signal
    );

    assertGatewayWriteSucceeded(gwResult);

    const receipt = await this.receipts.append({
      type: "erc8183_submit",
      taskId: `setProvider-${input.jobId}`,
      jobId: input.jobId,
      agentId: this.config.agentId,
      request: body,
      response: gwResult.circleResult ?? gwResult,
      proof: {
        sha256: sha256Json(gwResult.circleResult ?? gwResult),
        txHash: gwResult.txHash,
        operationId: gwResult.operationId,
        operationState: gwResult.state,
        idempotent: gwResult.idempotent,
      }
    });

    return { ok: gwResult.ok, txHash: gwResult.txHash, result: gwResult.circleResult, receipt, operationId: gwResult.operationId, idempotent: gwResult.idempotent };
  }

  // ── Reconciliation (operator path) ─────────────────────────────────

  /**
   * Append receipt and link to operation journal.
   * Wraps receipts.append + gateway.storeReceipt atomically.
   */
  private async appendReceiptAndLink(
    gwResult: { operationId: string; txHash?: string; state: string; idempotent?: boolean; circleResult?: unknown },
    record: Parameters<JsonlReceiptStore["append"]>[0]
  ) {
    const receipt = await this.receipts.append(record);
    this.gateway.storeReceipt(gwResult.operationId, {
      receiptId: receipt.id,
      receiptHash: receipt.proof?.sha256,
      proofKind: record.type,
    });
    return receipt;
  }

  /**
   * List operations that need reconciliation (broadcast/unknown).
   * Operator-only: requires explicit access.
   */
  listReconcilableOperations() {
    return this.gateway.getReconcilableOperations();
  }

  /**
   * Reconcile a broadcast/unknown operation to a final state.
   * Operator-only: requires explicit access.
   */
  reconcileOperation(
    operationId: string,
    outcome: "confirmed" | "failed" | "unknown",
    details?: { txHash?: string; errorCode?: string; errorMessage?: string }
  ) {
    return this.gateway.reconcileBroadcast(operationId, outcome, details as any);
  }

  /**
   * Gateway deposit — gated behind allowGatewayDeposit config flag.
   * Disabled by default. Only for devops-admin role.
   */
  async gatewayDeposit(body: unknown, signal?: AbortSignal) {
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
      method: input.method,
      signal,
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
  async registerIdentityViaCircleCli(body: unknown, signal?: AbortSignal) {
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
      allowRegister: true,
      signal,
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
            chain: this.config.chain,
            signal,
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
   * Register ERC-8004 identity via Circle CLI and sync to erc8004_agents.
   * Called by ApprovalManager after approval is approved.
   *
   * Success = tx ✓ + upsert ✓ + visible in GET /api/erc8004/agents ✓
   * If tx succeeds but sync fails, returns ok: false with errorCode: failed_persistence.
   */
  async registerErc8004WithApproval(
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{
    ok: boolean;
    txHash?: string;
    tokenId?: string;
    agentId?: string;
    agentVisible?: boolean;
    errorCode?: string;
    reason?: string;
    [key: string]: unknown;
  }> {
    const metadataURI = params.metadataURI as string;
    const controllerAddress = params.controllerAddress as string;
    const role = params.role as string;
    const agentName = params.agentName as string;
    const metadataJson = params.metadataJson as Record<string, unknown> | undefined;
    const approvalId = params.approvalId as string | undefined;

    if (!metadataURI) {
      throw new RunnerError("MISSING_FIELD", "metadataURI is required", 400);
    }

    // Step 1: Preflight — validate sync config BEFORE submitting on-chain tx
    const consoleUrl = this.config.consoleUrl ?? process.env.ARCLAYER_CONSOLE_URL;
    if (!consoleUrl) {
      return {
        ok: false,
        agentVisible: false,
        errorCode: "no_console_url",
        reason: "ARCLAYER_CONSOLE_URL/consoleUrl is required before submitting ERC-8004 registration",
      };
    }

    // Validate Console URL format before proceeding
    let parsedConsoleUrl: URL;
    try {
      parsedConsoleUrl = new URL(consoleUrl);
      if (!["http:", "https:"].includes(parsedConsoleUrl.protocol)) {
        throw new Error(`unsupported protocol ${parsedConsoleUrl.protocol}`);
      }
    } catch (err) {
      return {
        ok: false,
        agentVisible: false,
        errorCode: "invalid_console_url",
        reason: `ARCLAYER_CONSOLE_URL/consoleUrl must be a valid http(s) URL: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const syncUrl = new URL("/api/erc8004/register/sync", parsedConsoleUrl).toString();

    const syncSecret = process.env.ARCLAYER_RUNNER_SYNC_SECRET;
    if (!syncSecret) {
      return {
        ok: false,
        agentVisible: false,
        errorCode: "sync_secret_not_configured",
        reason: "ARCLAYER_RUNNER_SYNC_SECRET is required before submitting ERC-8004 registration",
      };
    }

    // Step 2: Auth preflight + signer check before on-chain tx (skip on retry path)
    const skipOnChainTxHash = params.skipOnChainTxHash as string | undefined;
    let txHash: string;

    if (skipOnChainTxHash) {
      // Retry path: reuse existing txHash, skip auth preflight and Circle CLI
      txHash = skipOnChainTxHash;
    } else {
      // Auth preflight: verify Console accepts our Bearer token BEFORE submitting irreversible tx
      const preflight = await verifyConsoleSyncAuth(syncUrl, syncSecret, controllerAddress, signal);
      if (!preflight.ok) {
        return { ok: false, agentVisible: false, ...preflight };
      }

      // Verify controller matches configured Circle signer
      const configuredSigner = this.config.circleWalletAddress;
      if (!configuredSigner) {
        return {
          ok: false, agentVisible: false,
          errorCode: "controller_signer_mismatch",
          reason: "Circle wallet address not configured — cannot verify signer",
        };
      }
      if (controllerAddress.toLowerCase() !== configuredSigner.toLowerCase()) {
        return {
          ok: false, agentVisible: false,
          errorCode: "controller_signer_mismatch",
          reason: `Approved controller ${controllerAddress} does not match configured Circle signer ${configuredSigner}`,
        };
      }

      const registerResult = await this.registerIdentityViaCircleCli(
        { metadataURI },
        signal,
      );

      if (!registerResult.ok) {
        return {
          ok: false,
          reason: (registerResult as Record<string, unknown>).reason as string ?? "On-chain registration failed",
          errorCode: "onchain_failed",
        };
      }

      if (!registerResult.txHash) {
        return {
          ok: false,
          reason: "No txHash returned from Circle CLI registration",
          errorCode: "no_txhash",
        };
      }
      txHash = registerResult.txHash;
    }

    // Step 3: Sync to erc8004_agents via Console API
    try {
      // Retry loop for unmined tx (425 retryable)
      const MAX_SYNC_RETRIES = 12;
      const SYNC_RETRY_DELAY_MS = 5000;

      let lastSyncResult: Record<string, unknown> | null = null;

      for (let attempt = 1; attempt <= MAX_SYNC_RETRIES; attempt++) {
        if (signal?.aborted) {
          return { ok: false, txHash, agentVisible: false, errorCode: "aborted", reason: "Sync aborted by signal" };
        }

        const syncResponse = await fetch(syncUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${syncSecret}`,
          },
          body: JSON.stringify({
            txHash,
            controllerAddress,
            metadataURI,
            role,
            agentName,
            metadataJson: metadataJson ?? {},
            approvalId,
          }),
          signal,
        });

        const syncResult = (await syncResponse.json()) as Record<string, unknown>;
        lastSyncResult = syncResult;

        // Success
        if (syncResponse.ok && syncResult.ok === true) {
          return {
            ok: true,
            txHash,
            tokenId: syncResult.tokenId as string,
            agentId: syncResult.agentId as string,
            agentVisible: syncResult.agentVisible === true,
            role: syncResult.role as string,
          };
        }

        // Retryable: tx not mined yet
        if (syncResponse.status === 425 && syncResult.retryable === true) {
          if (attempt < MAX_SYNC_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, SYNC_RETRY_DELAY_MS));
            continue;
          }
          // Exhausted retries — return pending, NOT failed_persistence
          return {
            ok: false,
            txHash,
            agentVisible: false,
            errorCode: "sync_pending_retryable",
            retryable: true,
            reason: `Tx submitted (${txHash}) but dashboard sync pending after ${MAX_SYNC_RETRIES} attempts. Call erc8004.register_approval_execute again after receipt mines.`,
          };
        }

        // Non-retryable sync failure
        return {
          ok: false,
          txHash,
          tokenId: syncResult.tokenId as string | undefined,
          agentId: syncResult.agentId as string | undefined,
          agentVisible: syncResult.agentVisible === true,
          errorCode: (syncResult.errorCode as string) || "failed_persistence",
          reason: `On-chain tx succeeded but erc8004_agents sync failed: ${syncResult.detail ?? syncResult.error ?? "unknown"}`,
        };
      }

      // Should not reach here, but safety fallback
      return {
        ok: false,
        txHash,
        agentVisible: false,
        errorCode: "sync_pending_retryable",
        retryable: true,
        reason: `Sync loop exited unexpectedly. Last result: ${JSON.stringify(lastSyncResult)}`,
      };
    } catch (syncError: unknown) {
      // Network error calling console — tx succeeded but can't verify dashboard
      const message = syncError instanceof Error ? syncError.message : String(syncError);
      // If txHash exists, on-chain tx succeeded — sync can be retried later
      return {
        ok: false,
        txHash,
        agentVisible: false,
        errorCode: "sync_pending_retryable",
        retryable: true,
        reason: `On-chain tx submitted (${txHash}) but console sync call failed transiently: ${message}. Retry erc8004.register_approval_execute later to resync.`,
      };
    }
  }

  /**
   * Inspect an x402 service (read-only, no payment).
   * Only requires URL validation and host allowlist.
   */
  async inspectX402(body: unknown, signal?: AbortSignal) {
    const payment = PaymentRequestSchema.parse(body);
    assertX402InspectAllowed(this.config, payment);

    const result = await this.circle.inspectService({
      url: payment.url,
      method: payment.method,
      body: payment.body,
      signal,
    });

    return { ok: true, result };
  }

  /**
   * Pay an x402 service with idempotency and persistent spending limits.
   */
  async payX402(body: unknown, signal?: AbortSignal) {
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
          chain: this.config.chain,
          signal,
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
        const msg = error instanceof Error ? error.message : String(error);

        // ── Broker timeout: payment state unknown ─────────────────────
        // When the broker times out or signal is aborted, the Circle CLI
        // subprocess may have already submitted the payment or may still
        // be running. We must NOT mark the ledger as terminal failure —
        // leave the attempt pending so retries check idempotency correctly.
        const isBrokerTimeout = isBrokerAbortOrTimeout(error, signal);

        if (isBrokerTimeout) {
          await this.receipts.append({
            type: "x402_payment",
            agentId: this.config.agentId,
            idempotencyKey,
            request: payment,
            error: `BROKER_TIMEOUT: payment state unknown — ${msg}`,
            proof: { sha256: sha256Text(msg) }
          });
          // Do NOT call ledger.recordFailure — leave as pending attempt.
          // Retry will find hasPendingAttempt and either get a 409 (already
          // paid) or can resubmit with the same idempotency key.
          throw error;
        }

        // ── 409 already-paid/idempotent-safe ────────────────────────────
        // Circle CLI exits non-zero when server returns HTTP 409 (already paid
        // or active session). The payment WAS submitted — treat as idempotent
        // success if the server indicates the resource is already unlocked.
        const isAlreadyPaid =
          msg.includes("409") &&
          (msg.includes("already") ||
            msg.includes("active access session") ||
            msg.includes("Payment submitted"));

        if (isAlreadyPaid) {
          const receipt = await this.receipts.append({
            type: "x402_payment",
            agentId: this.config.agentId,
            idempotencyKey,
            request: payment,
            response: { ok: true, idempotent: true, alreadyPaid: true },
            proof: { circleError: msg, sha256: sha256Text(msg) }
          });

          await this.ledger.recordSuccess(idempotencyKey, receipt.id);
          return {
            ok: true,
            idempotent: true,
            alreadyPaid: true,
            message: "Server returned 409 — resource already unlocked (idempotent-safe)",
            receipt,
            idempotencyKey
          };
        }

        await this.ledger.recordFailure(idempotencyKey, msg);

        await this.receipts.append({
          type: "x402_payment",
          agentId: this.config.agentId,
          idempotencyKey,
          request: payment,
          error: msg
        });

        throw error;
      }
    });
  }

  async batchPayX402(body: unknown, signal?: AbortSignal) {
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
        const result = await this.payX402(payment, signal);
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

  /**
   * Close persistent stores and release resources.
   * Called during graceful shutdown.
   */
  async close(): Promise<void> {
    // Close gateway (operation journal SQLite) first
    this.gateway.close();

    // Receipt store and ledger may hold file handles
    if (typeof (this.receipts as any).close === "function") {
      await (this.receipts as any).close();
    }
    if (typeof (this.ledger as any).close === "function") {
      await (this.ledger as any).close();
    }
  }
}

function extractPossibleTxHash(value: unknown): string | undefined {
  const text = JSON.stringify(value);
  const match = text.match(/0x[a-fA-F0-9]{64}/);
  return match?.[0];
}
