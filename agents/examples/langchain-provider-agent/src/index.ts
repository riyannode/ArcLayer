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
 * Provider pricing mode:
 *   ENABLE_PROVIDER_SET_BUDGET=true — arclayer_provider_quote_job + arclayer_provider_set_budget become available
 *   Provider quotes complexity, sets budget (max 5 USDC), then runs job.
 *
 * Memory mode (opt-in, disabled by default):
 *   ENABLE_MEMORY=true — per-job thread memory via MemorySaver
 *   MEMORY_SCOPE=job — must be "job" (global memory disabled for safety)
 *
 * Environment:
 *   ARCLAYER_RUNNER_URL        — Runner HTTP URL
 *   ARCLAYER_RUNNER_SECRET     — Runner HMAC secret
 *   OPENAI_API_KEY             — OpenAI API key for the LLM
 *   OPENAI_MODEL               — Optional LangChain model id, default openai:gpt-4o
 *   ENABLE_AUTO_SUBMIT         — "true" to expose run-and-submit tool
 *   ENABLE_PROVIDER_SET_BUDGET — "true" to expose quote + set-budget tools
 *   ENABLE_MEMORY              — "true" to enable per-job thread memory
 *   MEMORY_SCOPE               — must be "job" when ENABLE_MEMORY=true
 *   PROVIDER_MIN_BUDGET_USDC   — Min budget, default 1.00
 *   PROVIDER_MAX_BUDGET_USDC   — Max budget, default 5.00
 *   PROVIDER_LOW_COMPLEXITY_BUDGET_USDC    — default 1.00
 *   PROVIDER_MEDIUM_COMPLEXITY_BUDGET_USDC — default 3.00
 *   PROVIDER_HIGH_COMPLEXITY_BUDGET_USDC   — default 5.00
 *   TASK_POLL_INTERVAL_MS      — Poll interval, default 30000
 *   TASK_SOURCE                — "none" or "static", default "none"
 *   STATIC_PROVIDER_JOB_JSON   — JSON input for static test task
 */

import { createArcLayerLangChainAgent } from "@arclayer/langchain-adapter";
import { MemorySaver } from "@langchain/langgraph";

// ── Config ──────────────────────────────────────────────────────────────

const RUNNER_URL = process.env.ARCLAYER_RUNNER_URL ?? "http://127.0.0.1:8787";
const RUNNER_SECRET = process.env.ARCLAYER_RUNNER_SECRET;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "openai:gpt-4o";
const ENABLE_AUTO_SUBMIT = process.env.ENABLE_AUTO_SUBMIT === "true";
const ENABLE_PROVIDER_SET_BUDGET = process.env.ENABLE_PROVIDER_SET_BUDGET === "true";
// Memory is disabled by default. When enabled, LangGraph may checkpoint
// messages containing provider job input. Only enable memory for safe,
// non-sensitive job payloads until job context is loaded server-side
// instead of from the prompt.
const ENABLE_MEMORY = process.env.ENABLE_MEMORY === "true";
const MEMORY_SCOPE = process.env.MEMORY_SCOPE ?? "job";
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

if (ENABLE_MEMORY && MEMORY_SCOPE !== "job") {
  console.error("MEMORY_SCOPE must be 'job'. Global provider memory is disabled for safety.");
  process.exit(1);
}

const checkpointer = ENABLE_MEMORY ? new MemorySaver() : undefined;

// ── Provider Pricing Policy ─────────────────────────────────────────────

const providerPricingPolicy = ENABLE_PROVIDER_SET_BUDGET
  ? {
      minBudgetUsdc: process.env.PROVIDER_MIN_BUDGET_USDC ?? "1.00",
      maxBudgetUsdc: process.env.PROVIDER_MAX_BUDGET_USDC ?? "5.00",
      lowComplexityBudgetUsdc: process.env.PROVIDER_LOW_COMPLEXITY_BUDGET_USDC ?? "1.00",
      mediumComplexityBudgetUsdc: process.env.PROVIDER_MEDIUM_COMPLEXITY_BUDGET_USDC ?? "3.00",
      highComplexityBudgetUsdc: process.env.PROVIDER_HIGH_COMPLEXITY_BUDGET_USDC ?? "5.00",
    }
  : undefined;

// ── Agent Setup ─────────────────────────────────────────────────────────

const agent = createArcLayerLangChainAgent({
  role: "provider",
  model: OPENAI_MODEL,
  runnerUrl: RUNNER_URL,
  runnerSecret: RUNNER_SECRET,
  enableProviderRunAndSubmit: ENABLE_AUTO_SUBMIT,
  enableProviderSetBudget: ENABLE_PROVIDER_SET_BUDGET,
  providerPricingPolicy,
  checkpointer,
});

// ── State ───────────────────────────────────────────────────────────────

let shuttingDown = false;
let staticTaskConsumed = false;

// ── Memory Helpers ─────────────────────────────────────────────────────

// NOTE: When ENABLE_MEMORY=true, LangGraph's MemorySaver checkpoints all
// messages — including the full job payload in the prompt. Do NOT enable
// memory for jobs containing sensitive/private user data until a future
// server-side job-context store avoids checkpointing raw input.

function safeThreadPart(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  return value.replaceAll(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 128);
}

function getProviderThreadId(job: unknown): string {
  const record = job && typeof job === "object" ? job as Record<string, unknown> : {};
  const taskId = safeThreadPart(record.taskId, "task");
  const jobId = safeThreadPart(record.jobId, "job");
  return `provider:${taskId}:${jobId}`;
}

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

  if (ENABLE_PROVIDER_SET_BUDGET) {
    const parts = [
      "You are an ArcLayer ERC-8183 provider agent with pricing capability.",
      "",
      "Pricing workflow:",
      "1. Use arclayer_provider_quote_job to assess job complexity (low/medium/high).",
      "2. Choose budget from complexity mapping: low=1 USDC, medium=3 USDC, high=5 USDC.",
      "3. Never request more than 5 USDC.",
      "4. Call arclayer_provider_set_budget with the jobId, amount, complexity, and a pricing reason.",
      "5. The reason will be encoded into on-chain calldata — do not include secrets.",
    ];

    if (ENABLE_AUTO_SUBMIT) {
      parts.push(
        "6. After budget is set, call arclayer_provider_run_and_submit.",
      );
    } else {
      parts.push(
        "6. After budget is set, call arclayer_provider_run_only.",
      );
    }

    parts.push(
      "",
      "Do not create, fund, complete, or reject jobs.",
      "Do not invent job IDs, agent IDs, wallet addresses, receipts, or tx hashes.",
      "",
      "Provider job JSON:",
      jobJson,
    );

    return parts.join("\n");
  }

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

  const result = await agent.invoke(
    { messages: [{ role: "user", content: prompt }] },
    ENABLE_MEMORY
      ? { configurable: { thread_id: getProviderThreadId(job) } }
      : undefined,
  );

  console.log("[provider-agent] result:", JSON.stringify(result, null, 2));
}

// ── Worker Loop ─────────────────────────────────────────────────────────

async function workerLoop(): Promise<void> {
  const availableTools = ["arclayer_provider_run_only", "arclayer_provider_quote_job"];
  if (ENABLE_AUTO_SUBMIT) {
    availableTools.push("arclayer_provider_run_and_submit");
  }
  if (ENABLE_PROVIDER_SET_BUDGET) {
    availableTools.push("arclayer_provider_set_budget");
  }

  console.log("[provider-agent] started");
  console.log(`  runner: ${RUNNER_URL}`);
  console.log(`  model: ${OPENAI_MODEL}`);
  console.log(`  task source: ${TASK_SOURCE}`);
  console.log(`  auto-submit: ${ENABLE_AUTO_SUBMIT}`);
  console.log(`  provider pricing: ${ENABLE_PROVIDER_SET_BUDGET}`);
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
