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
};

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

    // ── Circle CLI ────────────────────────────────────────────────────
    case "circle.status":
      return services.circleStatus();

    case "circle.gateway_balance": {
      if (!config.circleWalletAddress) {
        return { ok: false, error: "CIRCLE_WALLET_NOT_CONFIGURED" };
      }
      const gw = await services.circle.gatewayBalance(config.circleWalletAddress, config.chain);
      return { ok: true, result: gw };
    }

    case "circle.wallet_balance": {
      if (!config.circleWalletAddress) {
        return { ok: false, error: "CIRCLE_WALLET_NOT_CONFIGURED" };
      }
      const bal = await services.circle.walletBalance(config.circleWalletAddress, config.chain);
      return { ok: true, result: bal };
    }

    case "circle.wallet_budget": {
      if (!config.circleWalletAddress) {
        return { ok: false, error: "CIRCLE_WALLET_NOT_CONFIGURED" };
      }
      const budget = await services.circle.walletBudget(config.circleWalletAddress);
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
      return services.submitDeliverableViaCircleCli({
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
      }>(name, args);
      return services.createJob({
        provider: input.provider,
        evaluator: input.evaluator,
        expiredAt: input.expiredAt,
        description: input.description,
        hook: input.hook,
      }, ctx.signal);
    }

    case "erc8183.set_budget": {
      const input = validateMcpToolInput<{
        jobId: string;
        amount: string;
        optParams?: string;
      }>(name, args);
      return services.setBudget({
        jobId: input.jobId,
        amount: input.amount,
        optParams: input.optParams,
      }, ctx.signal);
    }

    case "erc8183.approve_usdc": {
      const input = validateMcpToolInput<{ amount: string }>(name, args);
      return services.approveUsdcForErc8183({
        amount: input.amount,
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

    // ── ERC-8004 Register via Circle CLI (Zod-validated) ──────────────
    case "erc8004.register_via_circle_cli": {
      const input = validateMcpToolInput<{ metadataURI: string }>(name, args);
      return services.registerIdentityViaCircleCli({
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

    default:
      // Try Console MCP proxy for unknown tools
      if (name.includes(".")) {
        const proxyResult = await proxyToConsoleMcp(name, args, mcp);
        if (proxyResult.proxied) {
          return proxyResult.ok
            ? proxyResult.result
            : { ok: false, error: proxyResult.error };
        }
      }
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
