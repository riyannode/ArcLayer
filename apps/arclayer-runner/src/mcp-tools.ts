/**
 * Runner-local MCP tool implementations.
 * Each tool calls existing Runner service methods.
 * No direct Circle CLI calls, no policy bypass.
 */

import type { RunnerServices } from "./services";
import type { ArcLayerMcpConnector } from "./mcp-connector";
import type { RunnerConfig } from "@arclayer/runner-core";

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

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
