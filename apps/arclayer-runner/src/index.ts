#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";
import { loadRunnerConfig, loadRunnerConfigForStdio } from "./config";
import { loadGlobalSkill } from "./skill";
import { createRuntimeConnector } from "./runtime";
import { ArcLayerMcpConnector } from "./mcp-connector";
import { createRouter } from "./http";
import { RunnerServices } from "./services";
import { handleMcpRequest } from "./mcp-server";
import { runMcpStdio } from "./mcp-stdio";
import { McpToolBroker, type ToolBudgetConfig } from "./mcp-broker";
import { runDoctor } from "./doctor";
import { registerInitCommand } from "./init";
import { registerSetupCommand } from "./setup";
import { registerInstallCommand } from "./install";

// Read version from package.json
let PKG_VERSION = "0.1.4";
try {
  const require = createRequire(import.meta.url);
  PKG_VERSION = require("../package.json").version;
} catch {
  // fallback
}

async function main() {
  const program = new Command();

  program
    .name("arclayer-runner")
    .description("ArcLayer Runner — policy boundary for external LLM runtimes with MCP bridge, Circle CLI, ERC-8004, ERC-8183, and x402")
    .version(PKG_VERSION);

  // ── start ─────────────────────────────────────────────────────────────
  program.command("start").action(async () => {
    const config = loadRunnerConfig();
    const skill = loadGlobalSkill(config.skillPath);

    const runtime = createRuntimeConnector(
      config.runtimeKind,
      config.runtimeEndpoint,
      config.runtimeRunPath,
      process.env.HERMES_API_SERVER_KEY || process.env.OPENCLAW_API_SERVER_KEY
    );

    const mcp = new ArcLayerMcpConnector({
      baseUrl: process.env.ARCLAYER_MCP_BASE_URL || config.runtimeEndpoint,
      token: process.env.ARCLAYER_MCP_TOKEN,
      agentId: config.agentId
    });

    const services = new RunnerServices(config, runtime, mcp, skill);

    // MCP Tool Broker — one instance at startup, shared across all /mcp requests.
    // Budget (maxCalls, maxTotalUsdc) and audit log persist for the runner lifetime.
    const brokerBudget: ToolBudgetConfig = {
      maxTotalUsdc: config.toolMaxTotalUsdc,
      maxCalls: config.toolMaxCalls,
      defaultTimeoutMs: config.toolDefaultTimeoutMs,
      maxOutputBytes: config.toolMaxOutputBytes,
    };
    const broker = config.toolBrokerEnabled ? new McpToolBroker(brokerBudget) : null;
    // Include broker in ctx so handleMcpTool can access it (introspection tools).
    const mcpToolCtx = { services, mcp, config, skill, broker: broker ?? undefined };

    const authMode = process.env.ARCLAYER_AUTH_MODE === "bearer" ? "bearer" : "hmac";

    const server = createRouter(
      [
        // ── Public routes (no auth) ─────────────────────────────────────
        {
          method: "GET",
          path: "/health",
          handler: async () => ({
            ok: true,
            runnerId: config.runnerId,
            agentId: config.agentId,
            runtimeKind: config.runtimeKind,
            paymentEnabled: config.paymentEnabled,
            skillHash: skill.sha256
          })
        },
        {
          method: "GET",
          path: "/.well-known/arclayer-agent.json",
          handler: async () => services.manifest()
        },
        {
          method: "GET",
          path: "/skills/arclayer-global",
          handler: async () => ({
            ok: true,
            path: skill.path,
            sha256: skill.sha256,
            content: skill.content
          })
        },

        // ── Protected: Runner MCP (JSON-RPC) ────────────────────────────
        {
          method: "POST",
          path: "/mcp",
          rawHandler: async (ctx) => {
            // Router already verified HMAC/Bearer auth and parsed body.
            // MCP handler receives pre-authenticated context — no internal auth needed.
            // Pass shared broker (null if disabled) for budget/audit enforcement.
            await handleMcpRequest(ctx.res, ctx.body, mcpToolCtx, broker);
          }
        },

        // ── Protected: HTTP API routes ──────────────────────────────────
        {
          method: "POST",
          path: "/runtime/run",
          handler: async ({ body, reserveTaskId, markTaskCompleted, markTaskFailed }) =>
            services.runGeneric(body, { reserveTaskId, markTaskCompleted, markTaskFailed })
        },
        {
          method: "POST",
          path: "/erc8004/prepare-register",
          handler: async ({ body }) => services.prepareRegister(body)
        },
        {
          method: "POST",
          path: "/erc8183/provider/run",
          handler: async ({ body, reserveTaskId, markTaskCompleted, markTaskFailed }) =>
            services.runErc8183ProviderJob(body, { reserveTaskId, markTaskCompleted, markTaskFailed })
        },
        {
          method: "POST",
          path: "/x402/inspect",
          handler: async ({ body }) => services.inspectX402(body)
        },
        {
          method: "POST",
          path: "/x402/pay",
          handler: async ({ body }) => services.payX402(body)
        },
        {
          method: "POST",
          path: "/x402/batch-pay",
          handler: async ({ body }) => services.batchPayX402(body)
        },
        {
          method: "GET",
          path: "/circle/status",
          handler: async () => services.circleStatus()
        },
        {
          method: "GET",
          path: "/receipts",
          handler: async ({ url }) => {
            const limit = Number(url.searchParams.get("limit") ?? "100");
            return { ok: true, receipts: await services.receipts.list(limit) };
          }
        },
        {
          method: "GET",
          path: "/ledger",
          handler: async ({ url }) => {
            const limit = Number(url.searchParams.get("limit") ?? "100");
            return services.getLedger(limit);
          }
        }
      ],
      config.runnerSecret,
      { authMode }
    );

    server.listen(config.port, config.host, () => {
      console.log(`ArcLayer Runner listening on http://${config.host}:${config.port}`);
      console.log(`Agent ${config.agentId} (${config.defaultRole}) -> ${config.runtimeKind} ${config.runtimeEndpoint}`);
      console.log(`Runtime run path: ${config.runtimeRunPath}`);
      console.log(`Runner MCP: POST /mcp (${authMode} auth)`);
      console.log(`Console MCP bridge: ${process.env.ARCLAYER_MCP_BASE_URL || config.runtimeEndpoint}/api/mcp`);
      console.log(`Payment: ${config.paymentEnabled ? "enabled" : "disabled"}`);
      console.log(`Auth: ${authMode.toUpperCase()} — required for all routes except /health, /.well-known/*, /skills/*`);
      console.log(`Host binding: ${config.host}`);
    });
  });

  // ── doctor ────────────────────────────────────────────────────────────
  program.command("doctor").action(async () => {
    const config = loadRunnerConfigForStdio();
    console.log("ArcLayer Runner Doctor\n");

    const results = await runDoctor(config);
    let allOk = true;

    for (const check of results) {
      const icon = check.ok ? "✅" : "❌";
      console.log(`${icon} ${check.name}: ${check.message}`);
      if (!check.ok) allOk = false;
    }

    console.log(`\n${allOk ? "All checks passed." : "Some checks failed. Fix issues before running in production."}`);
    process.exit(allOk ? 0 : 1);
  });

  // ── print-skill ───────────────────────────────────────────────────────
  program.command("print-skill").action(async () => {
    const config = loadRunnerConfig();
    const skill = loadGlobalSkill(config.skillPath);
    process.stdout.write(skill.content);
  });

  // ── status ────────────────────────────────────────────────────────────
  program.command("status").action(async () => {
    const config = loadRunnerConfig();
    const skill = loadGlobalSkill(config.skillPath);

    console.log(JSON.stringify({
      ok: true,
      runnerId: config.runnerId,
      agentId: config.agentId,
      runtimeKind: config.runtimeKind,
      runtimeEndpoint: config.runtimeEndpoint,
      runtimeRunPath: config.runtimeRunPath,
      paymentEnabled: config.paymentEnabled,
      circleWalletAddress: config.circleWalletAddress,
      chain: config.chain,
      skillHash: skill.sha256
    }, null, 2));
  });

  // ── mcp (STDIO) ──────────────────────────────────────────────────────
  program
    .command("mcp")
    .description("Start MCP server over STDIO (JSON-RPC 2.0 for Hermes/OpenClaw)")
    .action(async () => {
      // STDIO mode: no HTTP, no Bearer auth, process isolation is the boundary
      const config = loadRunnerConfigForStdio();
      let skill: { content: string; sha256: string; path: string };
      try {
        skill = loadGlobalSkill(config.skillPath);
      } catch {
        skill = { content: "", sha256: "", path: "(not found)" };
        process.stderr.write("[arclayer-runner-mcp] Global skill not found — continuing without it\n");
      }

      const runtime = createRuntimeConnector(
        config.runtimeKind,
        config.runtimeEndpoint,
        config.runtimeRunPath,
        process.env.HERMES_API_SERVER_KEY || process.env.OPENCLAW_API_SERVER_KEY
      );

      const mcp = new ArcLayerMcpConnector({
        baseUrl: process.env.ARCLAYER_MCP_BASE_URL || config.runtimeEndpoint,
        token: process.env.ARCLAYER_MCP_TOKEN,
        agentId: config.agentId
      });

      const services = new RunnerServices(config, runtime, mcp, skill);

      // Create MCP Tool Broker from config (STDIO mode)
      const brokerBudget: ToolBudgetConfig = {
        maxTotalUsdc: config.toolMaxTotalUsdc,
        maxCalls: config.toolMaxCalls,
        defaultTimeoutMs: config.toolDefaultTimeoutMs,
        maxOutputBytes: config.toolMaxOutputBytes,
      };
      const broker = config.toolBrokerEnabled ? new McpToolBroker(brokerBudget) : undefined;
      const mcpToolCtx = { services, mcp, config, skill, broker };

      await runMcpStdio(mcpToolCtx);
    });

  // ── init (non-interactive) ──────────────────────────────────────────────
  registerInitCommand(program);

  // ── setup (interactive wizard) ─────────────────────────────────────────
  registerSetupCommand(program);

  // ── install (MCP sidecar installer) ───────────────────────────────────
  registerInstallCommand(program);

  program.parse(process.argv);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
