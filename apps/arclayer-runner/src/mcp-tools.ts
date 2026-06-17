/**
 * Runner-local MCP tool implementations.
 * Each tool calls existing Runner service methods.
 * No direct Circle CLI calls, no policy bypass.
 *
 * Write/payment tools use Zod-based input parsing (from runner-core) to ensure
 * the same validation schema is used at parse time and execution time.
 * The broker pre-validates args; this layer parses into typed objects.
 */

import type { RunnerServices } from "./services";
import type { ArcLayerMcpConnector } from "./mcp-connector";
import type { RunnerConfig } from "@arclayer/runner-core";
import { validateMcpToolInput } from "@arclayer/runner-core";
import { getCirclePolicyStatus } from "./doctor";
import { resolveAllSkills, resolveSkill, getSkillsForRole, getSkillsByIds, bundleSkillsForRole, SKILL_MANIFEST, type RunnerRole } from "./skill-manifest";
import { getToolsForRole, getToolByName, CONSOLE_MCP_PROXY_TOOLS, ALL_TOOLS } from "./tool-registry";
import { getRolePreset, listRolePresets } from "./role-presets";
import { proxyToConsoleMcp } from "./console-tool-proxy";
import type { McpToolBroker } from "./mcp-broker";
import { ARC_CHAIN_ID, CONTRACTS } from "@arclayer/sdk";

export type McpToolContext = {
  services: RunnerServices;
  mcp: ArcLayerMcpConnector;
  config: RunnerConfig;
  skill: { content: string; sha256: string; path: string };
  /** MCP Tool Broker — per-session budget, timeout, audit. Optional for backward compat. */
  broker?: McpToolBroker;
  /**
   * AbortSignal propagated from the broker timeout.
   * When the broker fires a timeout, this signal is aborted so that
   * underlying Circle CLI subprocesses and HTTP fetches can be cancelled.
   */
  signal?: AbortSignal;
  /**
   * Timeout in ms for proxy calls to Console MCP.
   * Set by the executor based on broker timeout, so the SDK client
   * uses the same timeout as the broker's withTimeout wrapper.
   */
  proxyTimeoutMs?: number;
};

function encodeProviderBudgetReasonOptParams(input: {
  complexity: "low" | "medium" | "high";
  budgetUsdc: string;
  reason: string;
}): `0x${string}` {
  const payload = {
    version: 1,
    type: "provider_budget_reason",
    complexity: input.complexity,
    budgetUsdc: input.budgetUsdc,
    reason: input.reason,
  };
  return `0x${Buffer.from(JSON.stringify(payload), "utf8").toString("hex")}` as `0x${string}`;
}

export async function handleMcpTool(
  name: string,
  args: Record<string, unknown>,
  ctx: McpToolContext
): Promise<unknown> {
  const { services, mcp, config, skill } = ctx;

  switch (name) {
    // ── Runner introspection ──────────────────────────────────────────
    case "runner.health":
      return {
        ok: true,
        runnerId: config.runnerId,
        agentId: config.agentId,
        runtimeKind: config.runtimeKind,
        paymentEnabled: config.paymentEnabled,
        skillHash: skill.sha256
      };

    case "runner.manifest":
      return services.manifest();

    case "runner.skill":
      return {
        ok: true,
        path: skill.path,
        sha256: skill.sha256,
        content: skill.content
      };

    case "runner.receipts": {
      const limit = typeof args.limit === "number" ? args.limit : 100;
      return { ok: true, receipts: await services.receipts.list(limit) };
    }

    case "runner.ledger": {
      const limit = typeof args.limit === "number" ? args.limit : 100;
      return services.getLedger(limit);
    }

    case "runner.policy":
      return {
        ok: true,
        paymentEnabled: config.paymentEnabled,
        perTxLimitUsdc: config.perTxLimitUsdc,
        dailyLimitUsdc: config.dailyLimitUsdc,
        monthlyLimitUsdc: config.monthlyLimitUsdc,
        batchMaxItems: config.batchMaxItems,
        batchMaxTotalUsdc: config.batchMaxTotalUsdc,
        allowedX402Hosts: config.allowedX402Hosts,
        chain: config.chain,
        circleWalletAddress: config.circleWalletAddress
      };
    case "runner.list_reconcilable_operations":
      return services.listReconcilableOperations();
    case "runner.reconcile_operation": {
      const { operationId, outcome, txHash, errorCode, errorMessage } = args as {
        operationId: string;
        outcome: "confirmed" | "failed" | "unknown";
        txHash?: string;
        errorCode?: string;
        errorMessage?: string;
      };
      if (!operationId || !outcome) {
        return { ok: false, error: "MISSING_FIELDS", message: "operationId and outcome are required" };
      }
      if (!["confirmed", "failed", "unknown"].includes(outcome)) {
        return { ok: false, error: "INVALID_OUTCOME", message: "outcome must be confirmed, failed, or unknown" };
      }
      const reconciled = services.reconcileOperation(operationId, outcome, { txHash, errorCode, errorMessage });
      return { ok: true, operationId, state: reconciled.state };
    }

    // ── MCP Tool Broker ───────────────────────────────────────────────
    case "runner.broker_status": {
      if (!ctx.broker) {
        return { ok: false, error: "BROKER_NOT_ENABLED", message: "MCP Tool Broker is not enabled for this session" };
      }
      const state = ctx.broker.getState();
      return {
        ok: true,
        enabled: true,
        callCount: state.callCount,
        totalCostMicros: state.totalCostMicros.toString(),
        budgetLimits: {
          maxCalls: ctx.config.toolMaxCalls,
          maxTotalUsdc: ctx.config.toolMaxTotalUsdc,
          defaultTimeoutMs: ctx.config.toolDefaultTimeoutMs,
          maxOutputBytes: ctx.config.toolMaxOutputBytes,
        }
      };
    }

    case "runner.audit_log": {
      if (!ctx.broker) {
        return { ok: false, error: "BROKER_NOT_ENABLED", message: "MCP Tool Broker is not enabled for this session" };
      }
      const limit = typeof args.limit === "number" ? Math.min(args.limit, 200) : 50;
      const log = ctx.broker.getAuditLog();
      return {
        ok: true,
        total: log.length,
        entries: log.slice(-limit)
      };
    }

    // ── Wallet Status ────────────────────────────────────────────────────
    case "circle.status":
      return services.circleStatus();

    case "circle.gateway_balance": {
      if (!config.circleWalletAddress) {
        return { ok: false, error: "CIRCLE_WALLET_NOT_CONFIGURED" };
      }
      const gw = await services.wallet.gatewayBalance(config.circleWalletAddress, config.chain);
      return { ok: true, result: gw };
    }

    case "circle.wallet_balance": {
      if (!config.circleWalletAddress) {
        return { ok: false, error: "CIRCLE_WALLET_NOT_CONFIGURED" };
      }
      const bal = await services.wallet.walletBalance(config.circleWalletAddress, config.chain);
      return { ok: true, result: bal };
    }

    case "circle.wallet_budget": {
      if (!config.circleWalletAddress) {
        return { ok: false, error: "CIRCLE_WALLET_NOT_CONFIGURED" };
      }
      const budget = await services.wallet.walletBudget(config.circleWalletAddress);
      return { ok: true, result: budget };
    }

    case "circle.wallet_policy_status":
      return getCirclePolicyStatus(config);

    // ── x402 (Zod-validated) ──────────────────────────────────────────
    case "x402.inspect": {
      const input = validateMcpToolInput<{
        url: string;
        method: string;
        body?: unknown;
      }>(name, args);
      return services.inspectX402({
        type: "x402_service_pay",
        url: input.url,
        method: input.method,
        maxAmountUsdc: "0",
        reason: "inspect",
        body: input.body
      }, ctx.signal);
    }

    case "x402.pay": {
      const input = validateMcpToolInput<{
        url: string;
        method: string;
        maxAmountUsdc: string;
        reason: string;
        idempotencyKey?: string;
        body?: unknown;
      }>(name, args);
      return services.payX402({
        type: "x402_service_pay",
        url: input.url,
        method: input.method,
        maxAmountUsdc: input.maxAmountUsdc,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        body: input.body
      }, ctx.signal);
    }

    case "x402.batch_pay": {
      const input = validateMcpToolInput<{
        batchId: string;
        taskId: string;
        payments: Array<{
          url: string;
          method: string;
          maxAmountUsdc: string;
          reason: string;
          idempotencyKey?: string;
          body?: unknown;
        }>;
      }>(name, args);
      // Inject type literal and body for each payment — the MCP schema
      // doesn't include `type` (it's an internal constant), but
      // BatchPaymentRequestSchema requires it via PaymentRequestSchema.
      const payments = input.payments.map((p) => ({
        type: "x402_service_pay" as const,
        url: p.url,
        method: p.method,
        maxAmountUsdc: p.maxAmountUsdc,
        reason: p.reason,
        idempotencyKey: p.idempotencyKey,
        body: p.body,
      }));
      return services.batchPayX402({
        batchId: input.batchId,
        taskId: input.taskId,
        payments,
      }, ctx.signal);
    }

    case "x402.list_receipts": {
      const limit = typeof args.limit === "number" ? args.limit : 100;
      const all = await services.receipts.list(limit);
      return { ok: true, receipts: all.filter((r) => r.type === "x402_payment") };
    }

    case "x402.payment_policy":
      return {
        ok: true,
        paymentEnabled: config.paymentEnabled,
        perTxLimitUsdc: config.perTxLimitUsdc,
        dailyLimitUsdc: config.dailyLimitUsdc,
        monthlyLimitUsdc: config.monthlyLimitUsdc,
        batchMaxItems: config.batchMaxItems,
        batchMaxTotalUsdc: config.batchMaxTotalUsdc,
        allowedX402Hosts: config.allowedX402Hosts
      };

    // ── ERC-8004 (Zod-validated) ──────────────────────────────────────
    case "erc8004.prepare_register": {
      const input = validateMcpToolInput<{ metadataURI: string }>(name, args);
      return services.prepareRegister({ metadataURI: input.metadataURI });
    }

    // ── ERC-8183 Provider (Zod-validated) ─────────────────────────────
    case "erc8183.provider_run_job": {
      const input = validateMcpToolInput<{
        taskId: string;
        jobId: string;
        agentId: string;
        provider: string;
        description: string;
        input: unknown;
      }>(name, args);
      return services.runProviderJob({
        taskId: input.taskId,
        jobId: input.jobId,
        agentId: input.agentId,
        provider: input.provider,
        description: input.description,
        input: input.input,
        metadata: {}
      });
    }

    case "erc8183.provider_submit_deliverable": {
      const input = validateMcpToolInput<{
        jobId: string;
        deliverableHash: string;
      }>(name, args);
      // Normalize hash: ensure 0x prefix and 66 chars
      const hash = input.deliverableHash;
      const deliverableHash = (hash.startsWith("0x") && hash.length === 66
        ? hash
        : `0x${hash}`) as `0x${string}`;
      return services.submitDeliverableViaWallet({
        jobId: input.jobId,
        deliverableHash,
        optParams: "0x"
      }, ctx.signal);
    }

    case "erc8183.provider_run_and_submit": {
      const input = validateMcpToolInput<{
        taskId: string;
        jobId: string;
        agentId: string;
        provider: string;
        description: string;
        input: unknown;
      }>(name, args);
      return services.runAndSubmitProviderJob({
        taskId: input.taskId,
        jobId: input.jobId,
        agentId: input.agentId,
        provider: input.provider,
        description: input.description,
        input: input.input,
        metadata: {}
      });
    }

    case "erc8183.provider_runtime_status":
      return mcp.getRuntimeContext();

    // ── ERC-8183 Full Lifecycle (Zod-validated) ───────────────────────
    case "erc8183.create_job": {
      const input = validateMcpToolInput<{
        provider: string;
        evaluator: string;
        expiredAt: string | number;
        description: string;
        hook?: string;
        idempotencyKey?: string;
        requestId?: string;
      }>(name, args);
      return services.createJob({
        provider: input.provider,
        evaluator: input.evaluator,
        expiredAt: input.expiredAt,
        description: input.description,
        hook: input.hook,
        idempotencyKey: input.idempotencyKey,
        requestId: input.requestId,
      }, ctx.signal);
    }

    case "erc8183.set_budget": {
      const input = validateMcpToolInput<{
        jobId: string;
        amount: string;
        optParams?: string;
        complexity?: "low" | "medium" | "high";
        reason?: string;
      }>(name, args);

      const hasReasonFields = Boolean(input.reason || input.complexity);

      if (hasReasonFields && input.optParams) {
        return {
          ok: false,
          error: "INVALID_INPUT",
          message: "Provide either optParams or reason+complexity, not both",
        };
      }

      if (hasReasonFields && (!input.reason || !input.complexity)) {
        return {
          ok: false,
          error: "INVALID_INPUT",
          message: "Both reason and complexity are required when encoding provider budget reason",
        };
      }

      const optParams = hasReasonFields
        ? encodeProviderBudgetReasonOptParams({
            complexity: input.complexity!,
            budgetUsdc: input.amount,
            reason: input.reason!,
          })
        : input.optParams;

      return services.setBudget({
        jobId: input.jobId,
        amount: input.amount,
        optParams,
      }, ctx.signal);
    }

    case "erc8183.approve_usdc": {
      const input = validateMcpToolInput<{
        amount: string;
        idempotencyKey?: string;
        requestId?: string;
      }>(name, args);
      return services.approveUsdcForErc8183({
        amount: input.amount,
        idempotencyKey: input.idempotencyKey,
        requestId: input.requestId,
      }, ctx.signal);
    }

    case "erc8183.fund_job": {
      const input = validateMcpToolInput<{
        jobId: string;
        optParams?: string;
      }>(name, args);
      return services.fundJob({
        jobId: input.jobId,
        optParams: input.optParams,
      }, ctx.signal);
    }

    case "erc8183.complete_job": {
      const input = validateMcpToolInput<{
        jobId: string;
        reason: string;
        optParams?: string;
      }>(name, args);
      return services.completeJob({
        jobId: input.jobId,
        reason: input.reason,
        optParams: input.optParams,
      }, ctx.signal);
    }

    case "erc8183.reject_job": {
      const input = validateMcpToolInput<{
        jobId: string;
        reason: string;
        optParams?: string;
      }>(name, args);
      return services.rejectJob({
        jobId: input.jobId,
        reason: input.reason,
        optParams: input.optParams,
      }, ctx.signal);
    }

    case "erc8183.claim_refund": {
      const input = validateMcpToolInput<{ jobId: string }>(name, args);
      return services.claimRefund({
        jobId: input.jobId,
      }, ctx.signal);
    }

    case "erc8183.set_provider": {
      const input = validateMcpToolInput<{
        jobId: string;
        provider: string;
      }>(name, args);
      return services.setProvider({
        jobId: input.jobId,
        provider: input.provider,
      }, ctx.signal);
    }

    // ── ERC-8004 Register (execute) (Zod-validated) ──────────────
    case "erc8004.register_via_circle_cli": {
      const input = validateMcpToolInput<{ metadataURI: string }>(name, args);
      return services.registerIdentityViaWallet({
        metadataURI: input.metadataURI,
      }, ctx.signal);
    }

    // ── Gateway Deposit (Zod-validated) ────────────────────────────────
    case "circle.gateway_deposit": {
      const input = validateMcpToolInput<{
        amount: string;
        method?: string;
      }>(name, args);
      return services.gatewayDeposit({
        amount: input.amount,
        method: input.method,
      }, ctx.signal);
    }

    // ── Skill Context Tools ───────────────────────────────────────────
    case "runner.skills_list": {
      const skills = resolveAllSkills();
      return {
        ok: true,
        skills: skills.map((s) => ({
          id: s.id,
          title: s.title,
          path: s.path,
          exists: s.exists,
          sha256: s.sha256,
          roles: s.roles,
          capabilities: s.capabilities,
          status: s.status,
          exposeAsContext: s.exposeAsContext,
        })),
      };
    }

    case "runner.skill_get": {
      const skillId = args.skillId as string;
      if (!skillId) return { ok: false, error: "skillId is required" };
      const item = SKILL_MANIFEST.find((s) => s.id === skillId);
      if (!item) return { ok: false, error: `Skill not found: ${skillId}` };
      const resolved = resolveSkill(item);
      return {
        ok: true,
        id: resolved.id,
        title: resolved.title,
        path: resolved.path,
        exists: resolved.exists,
        sha256: resolved.sha256,
        content: resolved.content,
        roles: resolved.roles,
        capabilities: resolved.capabilities,
        status: resolved.status,
      };
    }

    case "runner.skills_bundle": {
      const role = args.role as string | undefined;
      const skillIds = args.skillIds as string[] | undefined;
      if (role) {
        return bundleSkillsForRole(role as RunnerRole);
      }
      if (skillIds && skillIds.length > 0) {
        const skills = getSkillsByIds(skillIds).filter((s) => s.exists && s.exposeAsContext);
        const parts = skills.map((s) => `# ── ${s.title} ──\n# Source: ${s.path}\n# SHA256: ${s.sha256}\n\n${s.content}`);
        return {
          role: "custom",
          skillCount: skills.length,
          bundle: parts.join("\n\n---\n\n"),
          skills: skills.map((s) => ({ id: s.id, sha256: s.sha256 ?? "", exists: true })),
        };
      }
      return { ok: false, error: "Provide role or skillIds" };
    }

    case "runner.role_profile": {
      const role = args.role as string;
      if (!role) return { ok: false, error: "role is required" };
      const preset = getRolePreset(role);
      if (!preset) return { ok: false, error: `Unknown role: ${role}. Available: ${listRolePresets().map((p) => p.id).join(", ")}` };
      return {
        ok: true,
        ...preset,
        availableRoles: listRolePresets(),
      };
    }

    case "runner.role_tools": {
      const role = args.role as string;
      if (!role) return { ok: false, error: "role is required" };
      const tools = getToolsForRole(role);
      return {
        ok: true,
        role,
        toolCount: tools.length,
        tools: tools.map((t) => ({
          name: t.name,
          source: t.source,
          status: t.status,
          risk: t.risk,
          capabilities: t.capabilities,
          description: t.description,
          requiresPolicy: t.requiresPolicy,
          requiresCircle: t.requiresCircle,
          requiresRuntime: t.requiresRuntime,
        })),
      };
    }

    // ── Approvals (client chat-mediated flow) ─────────────────────────
    case "approvals.create": {
      const input = validateMcpToolInput<{
        actionType: "createJob" | "approveUsdc" | "fundJob" | "claimRefund";
        walletAddress: string;
        chainId: number;
        jobId?: string;
        amount?: string;
        params: Record<string, unknown>;
        expiresInSeconds?: number;
        idempotencyKey?: string;
      }>(name, args);
      return services.approvalManager.createApproval({
        actionType: input.actionType,
        walletAddress: input.walletAddress,
        chainId: input.chainId,
        jobId: input.jobId,
        amount: input.amount,
        params: input.params,
        expiresInSeconds: input.expiresInSeconds,
        idempotencyKey: input.idempotencyKey,
      });
    }

    case "approvals.get": {
      const input = validateMcpToolInput<{
        approvalId: string;
        walletAddress: string;
        role: string;
      }>(name, args);
      const approval = services.approvalManager.getApproval(
        input.approvalId,
        input.walletAddress,
        input.role,
      );
      return { ok: true, approval };
    }

    case "approvals.approve": {
      const input = validateMcpToolInput<{
        approvalId: string;
        walletAddress: string;
        role: string;
        chainId: number;
        expectedRequestHash?: string;
      }>(name, args);
      return services.approvalManager.approve({
        approvalId: input.approvalId,
        walletAddress: input.walletAddress,
        role: input.role,
        chainId: input.chainId,
        expectedRequestHash: input.expectedRequestHash,
        signal: ctx.signal,
      });
    }

    case "approvals.reject": {
      const input = validateMcpToolInput<{
        approvalId: string;
        walletAddress: string;
        role: string;
        reason?: string;
      }>(name, args);
      return services.approvalManager.reject({
        approvalId: input.approvalId,
        walletAddress: input.walletAddress,
        role: input.role,
        reason: input.reason,
      });
    }

    case "approvals.cancel": {
      const input = validateMcpToolInput<{
        approvalId: string;
        walletAddress: string;
        role: string;
      }>(name, args);
      return services.approvalManager.cancel({
        approvalId: input.approvalId,
        walletAddress: input.walletAddress,
        role: input.role,
      });
    }

    case "approvals.list_pending": {
      const input = validateMcpToolInput<{
        walletAddress: string;
        limit?: number;
      }>(name, args);
      const approvals = services.approvalManager.listPending(
        input.walletAddress,
        input.limit,
      );
      return { ok: true, approvals, count: approvals.length };
    }

    // ── ERC-8004 Chat-Approved Registration ──────────────────────────
    case "erc8004.register_approval_create": {
      const input = validateMcpToolInput<{
        controllerAddress: string;
        ownerAddress: string;
        agentName: string;
        role: "provider" | "evaluator";
        metadataURI: string;
        metadataJson?: Record<string, unknown>;
        chainId?: number;
        registryAddress?: string;
        expiresInSeconds?: number;
        idempotencyKey?: string;
      }>(name, args);

      // Enforce canonical Arc Testnet values
      const CANONICAL_CHAIN_ID = ARC_CHAIN_ID;
      const CANONICAL_REGISTRY = CONTRACTS.ERC8004_IDENTITY_REGISTRY;

      if (input.chainId !== undefined && input.chainId !== CANONICAL_CHAIN_ID) {
        return { ok: false, error: "INVALID_CHAIN", message: `Only Arc Testnet (${CANONICAL_CHAIN_ID}) is supported. Got ${input.chainId}.` };
      }
      if (input.registryAddress !== undefined && input.registryAddress.toLowerCase() !== CANONICAL_REGISTRY.toLowerCase()) {
        return { ok: false, error: "INVALID_REGISTRY", message: `Only canonical registry ${CANONICAL_REGISTRY} is supported.` };
      }

      // Owner must match controller for register(string) flow
      if (input.ownerAddress.toLowerCase() !== input.controllerAddress.toLowerCase()) {
        return {
          ok: false,
          error: "OWNER_CONTROLLER_MISMATCH",
          message: "ownerAddress must match controllerAddress for register(string) flow",
        };
      }

      // Build params with role embedded
      const params: Record<string, unknown> = {
        controllerAddress: input.controllerAddress,
        ownerAddress: input.ownerAddress,
        agentName: input.agentName,
        role: input.role,
        metadataURI: input.metadataURI,
        metadataJson: input.metadataJson ?? {},
        registryAddress: input.registryAddress ?? CONTRACTS.ERC8004_IDENTITY_REGISTRY,
      };

      // Duplicate protection: check for existing approval with same controller + metadataURI + role (in active states)
      const existingApproval = services.approvalManager.findExistingByErc8004Signature(
        input.controllerAddress,
        input.metadataURI,
        input.role,
      );
      if (existingApproval) {
        const isActive = ["pending", "approved", "executing"].includes(existingApproval.state);
        if (isActive) {
          return {
            ok: true,
            approvalId: existingApproval.approvalId,
            state: existingApproval.state,
            duplicate: true,
            message: `Approval already exists for ${input.role} registration with this controller and metadata URI (state: ${existingApproval.state}).`,
            renderableMessage: services.approvalManager.buildRenderableMessage(existingApproval),
          };
        }
        // failed with on-chain txHash — block duplicate on-chain registration
        if (existingApproval.state === "failed") {
          const parsedResult = existingApproval.resultJson
            ? JSON.parse(existingApproval.resultJson) as Record<string, unknown>
            : {};
          const existingTxHash = existingApproval.txHash ?? parsedResult.txHash as string | undefined;
          if (existingTxHash) {
            return {
              ok: false,
              error: "DUPLICATE_ONCHAIN_REGISTRATION_ATTEMPT",
              message: "A previous ERC-8004 registration for this controller/metadataURI/role already submitted an on-chain transaction but failed during sync. Reconcile or retry sync instead of creating a new on-chain registration.",
              existingApprovalId: existingApproval.approvalId,
              txHash: existingTxHash,
            };
          }
        }
        // executed — return idempotent/existing with result data
        if (existingApproval.state === "executed") {
          const resultData = existingApproval.resultJson
            ? JSON.parse(existingApproval.resultJson) as Record<string, unknown>
            : {};
          return {
            ok: true,
            approvalId: existingApproval.approvalId,
            state: existingApproval.state,
            duplicate: true,
            idempotent: true,
            txHash: existingApproval.txHash ?? resultData.txHash as string | undefined,
            tokenId: resultData.tokenId as string | undefined,
            agentId: resultData.agentId as string | undefined,
            message: `ERC-8004 registration already executed for ${input.role} with this controller and metadata URI.`,
          };
        }
      }

      return services.approvalManager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: input.controllerAddress,
        chainId: input.chainId ?? ARC_CHAIN_ID,
        params,
        expiresInSeconds: input.expiresInSeconds,
        idempotencyKey: input.idempotencyKey,
      });
    }

    case "erc8004.register_approval_get": {
      const input = validateMcpToolInput<{ approvalId: string }>(name, args);
      const approval = services.approvalManager.getApprovalById(input.approvalId);
      if (!approval) {
        return { ok: false, error: "APPROVAL_NOT_FOUND", message: `Approval ${input.approvalId} not found` };
      }
      return { ok: true, approval, renderableMessage: services.approvalManager.buildRenderableMessage(approval) };
    }

    case "erc8004.register_approval_approve": {
      const input = validateMcpToolInput<{ approvalId: string }>(name, args);
      const approval = services.approvalManager.getApprovalById(input.approvalId);
      if (!approval) {
        return { ok: false, error: "APPROVAL_NOT_FOUND" };
      }
      return services.approvalManager.approveById(input.approvalId);
    }

    case "erc8004.register_approval_reject": {
      const input = validateMcpToolInput<{ approvalId: string; reason?: string }>(name, args);
      const approval = services.approvalManager.getApprovalById(input.approvalId);
      if (!approval) {
        return { ok: false, error: "APPROVAL_NOT_FOUND" };
      }
      return services.approvalManager.rejectById(input.approvalId, input.reason);
    }

    case "erc8004.register_approval_execute": {
      const input = validateMcpToolInput<{ approvalId: string }>(name, args);
      return services.approvalManager.executeErc8004Registration(input.approvalId, ctx.signal);
    }

    case "erc8004.register_approval_approve_and_execute": {
      const input = validateMcpToolInput<{ approvalId: string }>(name, args);
      return services.approvalManager.approveAndExecuteErc8004(input.approvalId, ctx.signal);
    }

    default:
      // Proxy to Console MCP — errors propagate to executor's error handler
      return proxyToConsoleMcp(name, args, mcp, ctx.proxyTimeoutMs);
  }
}
