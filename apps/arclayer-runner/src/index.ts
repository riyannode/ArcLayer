#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";
import { loadRunnerConfig, loadRunnerConfigForStdio } from "./config";
import { loadGlobalSkill } from "./skill";
import { createRuntimeConnector } from "./runtime";
import { ArcLayerMcpConnector } from "./mcp-connector";
import { createRouter } from "./http";
import { RunnerServices } from "./services";
import { runMcpStdio } from "./mcp-stdio";
import { McpToolBroker, type ToolBudgetConfig } from "./mcp-broker";
import { runDoctor } from "./doctor";
import { registerInitCommand } from "./init";
import { registerSetupCommand } from "./setup";
import { registerInstallCommand } from "./install";
import { createProviderWorker } from "./workers/provider";
import { createEvaluatorWorker } from "./workers/evaluator";
import {
  ensureIdentity,
  readIdentityState,
  readRegistrationState,
  writeIdentityState,
  writeRegistrationState,
} from "./identity-ensure";

function stderrLog(msg: string): void {
  process.stderr.write(`[arclayer-runner] ${msg}\n`);
}

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
    .description("ArcLayer Runner — policy boundary for external LLM runtimes with MCP bridge, wallet adapter, ERC-8004, ERC-8183, and x402")
    .version(PKG_VERSION);

  // ── start ─────────────────────────────────────────────────────────────
  program.command("start").action(async () => {
    const config = loadRunnerConfig();
    const skill = loadGlobalSkill(config.skillPath);

    const apiKey = config.runtimeKind === "hermes"
      ? process.env.HERMES_API_SERVER_KEY
      : config.runtimeKind === "openclaw"
        ? process.env.OPENCLAW_API_SERVER_KEY
        : undefined;

    const runtime = createRuntimeConnector(
      config.runtimeKind,
      config.runtimeEndpoint,
      config.runtimeRunPath,
      apiKey,
      config.runtimeTimeoutMs
    );

    const mcp = new ArcLayerMcpConnector({
      baseUrl: process.env.ARCLAYER_MCP_BASE_URL || config.runtimeEndpoint,
      token: process.env.ARCLAYER_MCP_TOKEN,
      agentId: config.agentId
    });

    const services = new RunnerServices(config, runtime, mcp, skill);

    // MCP Tool Broker — one instance at startup, shared across all requests.
    const brokerBudget: ToolBudgetConfig = {
      maxTotalUsdc: config.toolMaxTotalUsdc,
      maxCalls: config.toolMaxCalls,
      defaultTimeoutMs: config.toolDefaultTimeoutMs,
      maxOutputBytes: config.toolMaxOutputBytes,
    };
    const broker = config.toolBrokerEnabled ? new McpToolBroker(brokerBudget) : null;
    const mcpToolCtx = { services, mcp, config, skill, broker: broker ?? undefined };

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

        // ── Protected: HTTP API routes (HMAC-only) ──────────────────────
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
          path: "/erc8183/provider/run-only",
          handler: async ({ body, reserveTaskId, markTaskCompleted, markTaskFailed }) =>
            services.runProviderJob(body, { reserveTaskId, markTaskCompleted, markTaskFailed })
        },
        {
          method: "POST",
          path: "/erc8183/provider/run-and-submit",
          handler: async ({ body, reserveTaskId, markTaskCompleted, markTaskFailed }) =>
            services.runAndSubmitProviderJob(body, { reserveTaskId, markTaskCompleted, markTaskFailed })
        },
        {
          method: "POST",
          path: "/erc8183/provider/set-budget",
          handler: async ({ body }) => {
            const HARD_CAP = "5.00";
            const USDC_DECIMAL_6_REGEX = /^[0-9]+(\.[0-9]{1,6})?$/;
            function parseUsdcMicros(amount: string): bigint {
              if (!USDC_DECIMAL_6_REGEX.test(amount)) {
                throw new Error("amount must be a decimal string with at most 6 fractional digits");
              }
              const [whole, fraction = ""] = amount.split(".");
              return BigInt(`${whole}${fraction.padEnd(6, "0")}`);
            }
            const input = body as {
              jobId?: string;
              amount?: string;
              complexity?: string;
              reason?: string;
              optParams?: string;
            };

            // Validate required fields
            if (!input.jobId || !/^[0-9]+$/.test(input.jobId)) {
              return { ok: false, error: "jobId must be a numeric string" };
            }
            if (!input.amount || !USDC_DECIMAL_6_REGEX.test(input.amount)) {
              return { ok: false, error: "amount must be a decimal string with at most 6 fractional digits" };
            }
            if (!input.reason || typeof input.reason !== "string" || input.reason.trim().length === 0) {
              return { ok: false, error: "reason is required and must be non-empty" };
            }
            if (input.reason.length > 512) {
              return { ok: false, error: "reason must be 512 characters or fewer" };
            }
            if (!input.complexity || !["low", "medium", "high"].includes(input.complexity)) {
              return { ok: false, error: "complexity must be low, medium, or high" };
            }

            // Enforce budget bounds with bigint precision
            let amountMicros: bigint;
            let hardCapMicros: bigint;
            try {
              amountMicros = parseUsdcMicros(input.amount);
              hardCapMicros = parseUsdcMicros(HARD_CAP);
            } catch {
              return { ok: false, error: "amount must be a decimal string with at most 6 fractional digits" };
            }
            if (amountMicros <= 0n) {
              return { ok: false, error: "amount must be greater than 0" };
            }
            if (amountMicros > hardCapMicros) {
              return { ok: false, error: `amount must not exceed ${HARD_CAP} USDC` };
            }

            // Encode reason + complexity into optParams
            const payload = {
              version: 1,
              type: "provider_budget_reason",
              complexity: input.complexity,
              budgetUsdc: input.amount,
              reason: input.reason,
            };
            const optParams = `0x${Buffer.from(JSON.stringify(payload), "utf8").toString("hex")}`;

            return services.setBudget({
              jobId: input.jobId,
              amount: input.amount,
              optParams,
            });
          }
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
        },

        // ── Provider Runtime (Console MCP proxy) ─────────────────────────
        {
          method: "POST",
          path: "/provider/context",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.runtime_get_context", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/provider/resume-plan",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.runtime_get_resume_plan", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/provider/heartbeat",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.runtime_heartbeat", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/provider/start-job",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.runtime_start_job", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/provider/write-checkpoint",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.runtime_write_checkpoint", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/provider/retry-job",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.runtime_retry_job", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/provider/complete-run",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.runtime_complete_run", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/provider/list-assigned-jobs",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.list_assigned_jobs", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/provider/list-assigned-jobs-extended",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.list_assigned_jobs_extended", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/provider/list-open-jobs",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.list_open_jobs", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/provider/list-my-open-job-applications",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.list_my_open_job_applications", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/provider/apply-open-job",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.apply_open_job", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/provider/withdraw-open-job-application",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.withdraw_open_job_application", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/provider/publish-deliverable",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("provider.publish_deliverable", body as Record<string, unknown>)
        },

        // ── Provider: Submit Deliverable (runner-local, wallet adapter) ──
        {
          method: "POST",
          path: "/erc8183/provider/submit-deliverable",
          handler: async ({ body }) => {
            const input = body as { jobId?: string; deliverableHash?: string };
            if (!input.jobId || !/^[0-9]+$/.test(input.jobId)) {
              return { ok: false, error: "jobId must be a numeric string" };
            }
            if (!input.deliverableHash || typeof input.deliverableHash !== "string") {
              return { ok: false, error: "deliverableHash is required" };
            }
            const hash = input.deliverableHash;
            const deliverableHash = (hash.startsWith("0x") && hash.length === 66
              ? hash
              : `0x${hash}`) as `0x${string}`;
            return services.submitDeliverableViaWallet({
              jobId: input.jobId,
              deliverableHash,
              optParams: "0x"
            });
          }
        },

        // ── Provider: Runtime Status (runner-local, MCP connector) ───────
        {
          method: "POST",
          path: "/erc8183/provider/runtime-status",
          handler: async () => services.mcp.getRuntimeContext()
        },

        // ── Job Status + Lifecycle (Console MCP proxy) ───────────────────
        {
          method: "POST",
          path: "/jobs/onchain-status",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("jobs.get_onchain_status", body as Record<string, unknown>)
        },
        {
          method: "POST",
          path: "/jobs/lifecycle-summary",
          handler: async ({ body }) =>
            services.proxyToConsoleMcp("jobs.get_lifecycle_summary", body as Record<string, unknown>)
        }
      ],
      config.runnerSecret
    );

    server.listen(config.port, config.host, () => {
      console.log(`ArcLayer Runner REST: HMAC protected`);
      console.log(`ArcLayer Runner MCP: use 'arclayer-runner mcp'`);
      console.log(`Console MCP bridge: ${process.env.ARCLAYER_MCP_BASE_URL || config.runtimeEndpoint}/api/mcp`);
      console.log(`Agent ${config.agentId} (${config.defaultRole}) -> ${config.runtimeKind} ${config.runtimeEndpoint}`);
      console.log(`Runtime run path: ${config.runtimeRunPath}`);
      console.log(`Payment: ${config.paymentEnabled ? "enabled" : "disabled"}`);
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
    .description("Start ArcLayer Runner MCP over STDIO (for Hermes/OpenClaw)")
    .action(async () => {
      const config = loadRunnerConfigForStdio();
      let skill: { content: string; sha256: string; path: string };
      try {
        skill = loadGlobalSkill(config.skillPath);
      } catch {
        skill = { content: "", sha256: "", path: "(not found)" };
        process.stderr.write("[arclayer-runner-mcp] Global skill not found — continuing without it\n");
      }

      const apiKey = config.runtimeKind === "hermes"
        ? process.env.HERMES_API_SERVER_KEY
        : config.runtimeKind === "openclaw"
          ? process.env.OPENCLAW_API_SERVER_KEY
          : undefined;

      const runtime = createRuntimeConnector(
        config.runtimeKind,
        config.runtimeEndpoint,
        config.runtimeRunPath,
        apiKey,
        config.runtimeTimeoutMs
      );

      const mcp = new ArcLayerMcpConnector({
        baseUrl: process.env.ARCLAYER_MCP_BASE_URL || config.runtimeEndpoint,
        token: process.env.ARCLAYER_MCP_TOKEN,
        agentId: config.agentId
      });

      const services = new RunnerServices(config, runtime, mcp, skill);

      const brokerBudget: ToolBudgetConfig = {
        maxTotalUsdc: config.toolMaxTotalUsdc,
        maxCalls: config.toolMaxCalls,
        defaultTimeoutMs: config.toolDefaultTimeoutMs,
        maxOutputBytes: config.toolMaxOutputBytes,
      };
      const broker = config.toolBrokerEnabled ? new McpToolBroker(brokerBudget) : undefined;
      const mcpToolCtx = { services, mcp, config, skill, broker };

      await runMcpStdio(mcpToolCtx, {
        closeMcp: async () => {
          stderrLog('Closing MCP connector...');
          await mcp.close();
        },
        closeServices: async () => {
          stderrLog('Closing services...');
          await services.close?.();
        },
      });
    });

  // ── init (non-interactive) ──────────────────────────────────────────────
  registerInitCommand(program);

  // ── setup (interactive wizard) ─────────────────────────────────────────
  registerSetupCommand(program);

  // ── install (MCP sidecar installer) ───────────────────────────────────
  registerInstallCommand(program);

  // ── identity ──────────────────────────────────────────────────────────
  const identityCmd = program
    .command("identity")
    .description("Manage ERC-8004 identity");

  identityCmd
    .command("ensure")
    .description("Ensure ERC-8004 identity exists (register if missing)")
    .requiredOption("--agent-name <name>", "Agent name for metadata")
    .option("--role <role>", "Agent role", "provider")
    .option("--description <desc>", "Agent description")
    .option("--capabilities <caps>", "Comma-separated capabilities")
    .option("--auto-register", "Register identity if missing (requires allowIdentityRegister=true)")
    .action(async (opts: {
      agentName: string;
      role: string;
      description?: string;
      capabilities?: string;
      autoRegister?: boolean;
    }) => {
      const config = loadRunnerConfig();

      if (opts.autoRegister && !config.allowIdentityRegister) {
        console.error("❌ --auto-register requires allowIdentityRegister=true in config");
        console.error("   Set ARCLAYER_ALLOW_IDENTITY_REGISTER=true in .env.runner");
        process.exit(1);
      }

      if (!config.circleWalletAddress) {
        console.error("❌ CIRCLE_WALLET_ADDRESS required for identity ensure");
        process.exit(1);
      }

      const skill = loadGlobalSkill(config.skillPath);
      const runtime = createRuntimeConnector(
        config.runtimeKind,
        config.runtimeEndpoint,
        config.runtimeRunPath,
        undefined,
        config.runtimeTimeoutMs,
      );
      const mcp = new ArcLayerMcpConnector({
        baseUrl: process.env.ARCLAYER_MCP_BASE_URL ?? config.runtimeEndpoint,
        token: process.env.ARCLAYER_MCP_TOKEN,
        agentId: config.agentId,
      });
      const services = new RunnerServices(config, runtime, mcp, skill);

      try {
        const result = await ensureIdentity({
          agentName: opts.agentName,
          role: opts.role,
          description: opts.description,
          capabilities: opts.capabilities,
          autoRegister: opts.autoRegister ?? false,
          walletAddress: config.circleWalletAddress,
          registerFn: async (metadataURI: string, idempotencyKey: string) => {
            return services.registerIdentityViaWallet({ metadataURI, idempotencyKey }) as Promise<{
              ok: boolean;
              txHash?: string;
              result?: unknown;
            }>;
          },
          finalizeFn: async (txHash: string, metadataURI?: string) => {
            return services.finalizeIdentityRegistration(txHash, metadataURI);
          },
        });

        console.log(`\n${result.action === "already_confirmed" || result.action === "confirmed_pending" ? "✅" : result.action === "registered" ? "🔧" : "⚠️"} ${result.message}`);

        if (result.identity.tokenId) {
          console.log(`   Token ID: ${result.identity.tokenId}`);
        }
        if (result.identity.txHash) {
          console.log(`   TX Hash: ${result.identity.txHash}`);
        }

        if (result.action === "failed") {
          process.exit(1);
        }
      } catch (err) {
        console.error(`❌ Identity ensure failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      } finally {
        await mcp.close();
      }
    });

  identityCmd
    .command("status")
    .description("Show current ERC-8004 identity state")
    .action(() => {
      const identity = readIdentityState();
      const registration = readRegistrationState();

      console.log("Identity state:");
      console.log(JSON.stringify(identity, null, 2));

      if (registration) {
        console.log("\nRegistration state:");
        console.log(JSON.stringify(registration, null, 2));
      }
    });

  // ── Helper: create runner context for workers ───────────────────────
  function createRunnerContext() {
    const config = loadRunnerConfig();
    const skill = loadGlobalSkill(config.skillPath);

    const apiKey =
      config.runtimeKind === "hermes"
        ? process.env.HERMES_API_SERVER_KEY
        : config.runtimeKind === "openclaw"
          ? process.env.OPENCLAW_API_SERVER_KEY
          : undefined;

    const runtime = createRuntimeConnector(
      config.runtimeKind,
      config.runtimeEndpoint,
      config.runtimeRunPath,
      apiKey,
      config.runtimeTimeoutMs,
    );

    const mcp = new ArcLayerMcpConnector({
      baseUrl: process.env.ARCLAYER_MCP_BASE_URL ?? config.runtimeEndpoint,
      token: process.env.ARCLAYER_MCP_TOKEN,
      agentId: config.agentId,
    });

    const services = new RunnerServices(config, runtime, mcp, skill);

    return { config, skill, runtime, mcp, services };
  }

  // ── provider (primary command) ──────────────────────────────────────
  program
    .command("provider")
    .description("Run the autonomous ERC-8183 provider service")
    .option("--once", "Run one poll cycle then exit")
    .action(async ({ once }: { once?: boolean }) => {
      const context = createRunnerContext();

      const worker = createProviderWorker(
        context.config,
        context.services,
        context.mcp,
        context.runtime,
      );

      const shutdown = async () => {
        await worker.stop();
        await context.mcp.close();
        process.exit(0);
      };

      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);

      if (once) {
        await worker.runOnce();
        await context.mcp.close();
        return;
      }

      await worker.start();
    });

  // ── provider-worker (deprecated alias) ─────────────────────────────
  program
    .command("provider-worker")
    .description("[deprecated] Use 'arclayer-runner provider' instead")
    .option("--once", "Run one poll cycle then exit")
    .action(async ({ once }: { once?: boolean }) => {
      process.stderr.write(
        "[arclayer-runner] provider-worker is deprecated. Use arclayer-runner provider.\n",
      );
      const context = createRunnerContext();

      const worker = createProviderWorker(
        context.config,
        context.services,
        context.mcp,
        context.runtime,
      );

      const shutdown = async () => {
        await worker.stop();
        await context.mcp.close();
        process.exit(0);
      };

      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);

      if (once) {
        await worker.runOnce();
        await context.mcp.close();
        return;
      }

      await worker.start();
    });

  // ── evaluator-worker ────────────────────────────────────────────────
  program
    .command("evaluator-worker")
    .description("Run the autonomous evaluator worker")
    .option("--once", "Run one poll cycle then exit")
    .action(async ({ once }: { once?: boolean }) => {
      const context = createRunnerContext();

      const worker = createEvaluatorWorker(
        context.config,
        context.services,
        context.mcp,
        context.runtime,
      );

      const shutdown = async () => {
        await worker.stop();
        await context.mcp.close();
        process.exit(0);
      };

      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);

      if (once) {
        await worker.runOnce();
        await context.mcp.close();
        return;
      }

      await worker.start();
    });

  program.parse(process.argv);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
