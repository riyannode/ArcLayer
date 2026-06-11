#!/usr/bin/env node
import { Command } from "commander";
import { loadRunnerConfig } from "./config";
import { loadGlobalSkill } from "./skill";
import { createRuntimeConnector } from "./runtime";
import { ArcLayerMcpConnector } from "./mcp-connector";
import { createRouter } from "./http";
import { RunnerServices } from "./services";
import { runDoctor } from "./doctor";

async function main() {
  const program = new Command();

  program
    .name("arclayer-runner")
    .description("ArcLayer Runner — policy boundary for external LLM runtimes with MCP bridge, Circle CLI, ERC-8004, ERC-8183, and x402")
    .version("0.1.0");

  // ── start ─────────────────────────────────────────────────────────────
  program.command("start").action(async () => {
    const config = loadRunnerConfig();
    const skill = loadGlobalSkill(config.skillPath);

    // Runtime connector (Hermes / OpenClaw / custom)
    const runtime = createRuntimeConnector(
      config.runtimeKind,
      config.runtimeEndpoint,
      config.runtimeRunPath,
      process.env.HERMES_API_SERVER_KEY || process.env.OPENCLAW_API_SERVER_KEY
    );

    // MCP connector — bridges to existing ArcLayer MCP server
    const mcp = new ArcLayerMcpConnector({
      baseUrl: process.env.ARCLAYER_MCP_BASE_URL || config.runtimeEndpoint,
      token: process.env.ARCLAYER_MCP_TOKEN,
      agentId: config.agentId
    });

    const services = new RunnerServices(config, runtime, mcp, skill);

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

        // ── Protected routes (auth required) ────────────────────────────
        {
          method: "POST",
          path: "/runtime/run",
          handler: async ({ body }) => services.runGeneric(body)
        },
        {
          method: "POST",
          path: "/erc8004/prepare-register",
          handler: async ({ body }) => services.prepareRegister(body)
        },
        {
          method: "POST",
          path: "/erc8183/provider/run",
          handler: async ({ body }) => services.runErc8183ProviderJob(body)
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
            return {
              ok: true,
              receipts: await services.receipts.list(limit)
            };
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
      config.runnerSecret
    );

    server.listen(config.port, () => {
      console.log(`ArcLayer Runner listening on http://127.0.0.1:${config.port}`);
      console.log(`Agent ${config.agentId} (${config.defaultRole}) -> ${config.runtimeKind} ${config.runtimeEndpoint}`);
      console.log(`Runtime run path: ${config.runtimeRunPath}`);
      console.log(`MCP bridge: ${process.env.ARCLAYER_MCP_BASE_URL || config.runtimeEndpoint}/api/mcp`);
      console.log(`Payment: ${config.paymentEnabled ? "enabled" : "disabled"}`);
      console.log(`Auth: required for protected routes`);
    });
  });

  // ── doctor ────────────────────────────────────────────────────────────
  program.command("doctor").action(async () => {
    const config = loadRunnerConfig();
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

  program.parse(process.argv);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
