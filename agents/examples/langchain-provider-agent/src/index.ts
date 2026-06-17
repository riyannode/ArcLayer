/**
 * Minimal PM2-compatible ERC-8183 provider agent.
 *
 * Uses @arclayer/langchain-adapter with role "provider".
 * External LLM API only — no local model.
 *
 * Default behavior:
 *   ENABLE_AUTO_SUBMIT=false — only arclayer_provider_run_only is available
 *
 * Autonomous submit mode:
 *   ENABLE_AUTO_SUBMIT=true — arclayer_provider_run_and_submit becomes available
 *
 * Environment:
 *   ARCLAYER_RUNNER_URL        — Runner HTTP URL
 *   ARCLAYER_RUNNER_SECRET     — Runner HMAC secret
 *   OPENAI_API_KEY             — OpenAI API key for the LLM
 *   OPENAI_MODEL               — Optional LangChain model id, default openai:gpt-4o
 *   ENABLE_AUTO_SUBMIT         — "true" to expose run-and-submit tool
 *   TASK_POLL_INTERVAL_MS      — Poll interval, default 30000
 *   TASK_SOURCE                — "none" or "static", default "none"
 *   STATIC_PROVIDER_JOB_JSON   — JSON input for static test task
 */

import { createArcLayerLangChainAgent } from "@arclayer/langchain-adapter";

// ── Config ──────────────────────────────────────────────────────────────

const RUNNER_URL = process.env.ARCLAYER_RUNNER_URL ?? "http://127.0.0.1:8787";
const RUNNER_SECRET = process.env.ARCLAYER_RUNNER_SECRET;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "openai:gpt-4o";
const ENABLE_AUTO_SUBMIT = process.env.ENABLE_AUTO_SUBMIT === "true";
const TASK_SOURCE = process.env.TASK_SOURCE ?? "none";
const TASK_POLL_INTERVAL_MS = Number.parseInt(
  process.env.TASK_POLL_INTERVAL_MS ?? "30000",
  10,
);

if (!RUNNER_SECRET) {
  console.error("ARCLAYER_RUNNER_SECRET is required");
  process.exit(1);
}

if (!Number.isFinite(TASK_POLL_INTERVAL_MS) || TASK_POLL_INTERVAL_MS < 1000) {
  console.error("TASK_POLL_INTERVAL_MS must be >= 1000");
  process.exit(1);
}

// ── Agent Setup ─────────────────────────────────────────────────────────

const agent = createArcLayerLangChainAgent({
  role: "provider",
  model: OPENAI_MODEL,
  runnerUrl: RUNNER_URL,
  runnerSecret: RUNNER_SECRET,
  enableProviderRunAndSubmit: ENABLE_AUTO_SUBMIT,
});

// ── State ───────────────────────────────────────────────────────────────

let shuttingDown = false;
let staticTaskConsumed = false;

// ── Helpers ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadStaticProviderJob(): unknown | null {
  if (TASK_SOURCE !== "static") return null;
  if (staticTaskConsumed) return null;

  const raw = process.env.STATIC_PROVIDER_JOB_JSON;
  if (!raw) {
    console.warn(
      "[provider-agent] TASK_SOURCE=static but STATIC_PROVIDER_JOB_JSON is empty",
    );
    return null;
  }

  try {
    staticTaskConsumed = true;
    return JSON.parse(raw);
  } catch {
    console.error(
      "[provider-agent] STATIC_PROVIDER_JOB_JSON is not valid JSON",
    );
    return null;
  }
}

function buildProviderPrompt(job: unknown): string {
  const jobJson = JSON.stringify(job, null, 2);

  if (ENABLE_AUTO_SUBMIT) {
    return [
      "You are an ArcLayer ERC-8183 provider agent.",
      "Use arclayer_provider_run_and_submit only for the exact provider job below.",
      "Do not create, fund, complete, or reject jobs.",
      "Do not invent job IDs, agent IDs, wallet addresses, receipts, or tx hashes.",
      "Provider job JSON:",
      jobJson,
    ].join("\n");
  }

  return [
    "You are an ArcLayer ERC-8183 provider agent.",
    "Use arclayer_provider_run_only for the exact provider job below.",
    "Do not submit on-chain.",
    "Do not create, fund, complete, or reject jobs.",
    "Do not invent job IDs, agent IDs, wallet addresses, receipts, or tx hashes.",
    "Provider job JSON:",
    jobJson,
  ].join("\n");
}

// ── Task Processing ─────────────────────────────────────────────────────

async function processTask(job: unknown): Promise<void> {
  const prompt = buildProviderPrompt(job);

  const result = await agent.invoke({
    messages: [{ role: "user", content: prompt }],
  });

  console.log("[provider-agent] result:", JSON.stringify(result, null, 2));
}

// ── Worker Loop ─────────────────────────────────────────────────────────

async function workerLoop(): Promise<void> {
  const availableTools = ["arclayer_provider_run_only"];
  if (ENABLE_AUTO_SUBMIT) {
    availableTools.push("arclayer_provider_run_and_submit");
  }

  console.log("[provider-agent] started");
  console.log(`  runner: ${RUNNER_URL}`);
  console.log(`  model: ${OPENAI_MODEL}`);
  console.log(`  task source: ${TASK_SOURCE}`);
  console.log(`  auto-submit: ${ENABLE_AUTO_SUBMIT}`);
  console.log(`  tools: ${availableTools.join(", ")}`);

  while (!shuttingDown) {
    const job = loadStaticProviderJob();

    if (job) {
      try {
        await processTask(job);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[provider-agent] task failed:", message);
      }
    } else {
      console.log("[provider-agent] idle: no provider task available");
    }

    await sleep(TASK_POLL_INTERVAL_MS);
  }

  console.log("[provider-agent] stopped");
}

// ── Graceful Shutdown ───────────────────────────────────────────────────

process.on("SIGINT", () => {
  shuttingDown = true;
});

process.on("SIGTERM", () => {
  shuttingDown = true;
});

// ── Entry ───────────────────────────────────────────────────────────────

workerLoop().catch((err) => {
  console.error("[provider-agent] fatal:", err);
  process.exit(1);
});
