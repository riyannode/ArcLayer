/**
 * Runner-local MCP tool implementations.
 * Each tool calls existing Runner service methods.
 * No direct Circle CLI calls, no policy bypass.
 */

import type { RunnerServices } from "./services";
import type { ArcLayerMcpConnector } from "./mcp-connector";
import type { RunnerConfig } from "@arclayer/runner-core";
import { getCirclePolicyStatus } from "./doctor";
import { resolveAllSkills, resolveSkill, getSkillsForRole, getSkillsByIds, bundleSkillsForRole, SKILL_MANIFEST, type RunnerRole } from "./skill-manifest";
import { getToolsForRole, getToolByName, CONSOLE_MCP_PROXY_TOOLS, ALL_TOOLS } from "./tool-registry";
import { getRolePreset, listRolePresets } from "./role-presets";
import { proxyToConsoleMcp } from "./console-tool-proxy";

export type McpToolContext = {
  services: RunnerServices;
  mcp: ArcLayerMcpConnector;
  config: RunnerConfig;
  skill: { content: string; sha256: string; path: string };
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

    // ── x402 ──────────────────────────────────────────────────────────
    case "x402.inspect":
      return services.inspectX402({
        type: "x402_service_pay",
        url: args.url as string,
        method: (args.method as string) ?? "GET",
        maxAmountUsdc: "0",
        reason: "inspect",
        body: args.body
      });

    case "x402.pay":
      return services.payX402({
        type: "x402_service_pay",
        url: args.url as string,
        method: (args.method as string) ?? "GET",
        maxAmountUsdc: args.maxAmountUsdc as string,
        reason: args.reason as string,
        idempotencyKey: args.idempotencyKey as string | undefined,
        body: args.body
      });

    case "x402.batch_pay":
      return services.batchPayX402({
        batchId: args.batchId as string,
        taskId: args.taskId as string,
        payments: args.payments as any[]
      });

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

    // ── ERC-8004 ──────────────────────────────────────────────────────
    case "erc8004.prepare_register":
      return services.prepareRegister({ metadataURI: args.metadataURI });

    // ── ERC-8183 ──────────────────────────────────────────────────────
    case "erc8183.provider_run_job":
      return services.runErc8183ProviderJob({
        taskId: args.taskId as string,
        jobId: args.jobId as string,
        agentId: args.agentId as string,
        provider: args.provider as string,
        description: args.description as string,
        input: args.input,
        metadata: {}
      });

    case "erc8183.provider_submit_deliverable": {
      const hash = args.deliverableHash as string;
      const deliverableHash = (hash.startsWith("0x") && hash.length === 66
        ? hash
        : `0x${hash}`) as `0x${string}`;
      return services.submitDeliverableViaCircleCli({
        jobId: args.jobId as string,
        deliverableHash,
        optParams: "0x"
      });
    }

    case "erc8183.provider_run_and_submit":
      return services.runErc8183ProviderJob({
        taskId: args.taskId as string,
        jobId: args.jobId as string,
        agentId: args.agentId as string,
        provider: args.provider as string,
        description: args.description as string,
        input: args.input,
        metadata: {}
      });

    case "erc8183.provider_runtime_status":
      return mcp.getRuntimeContext();

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
