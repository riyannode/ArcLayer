/**
 * Minimal PM2-compatible ERC-8183 provider agent.
 *
 * v3: No Runner dependency. Direct mode via Circle Dev Wallet adapter.
 *
 * Production mode (LIVE_MODE=true):
 *   Deterministic live-driver with local LLM service + direct on-chain writes.
 *   Uses provider-service.ts for LLM, provider-write-circle.ts for Circle SDK.
 *
 * Legacy mode (LIVE_MODE=false):
 *   Worker loop with local LLM. No on-chain writes.
 *   For testing only — does not submit on-chain.
 *
 * Environment:
 *   CIRCLE_API_KEY             — Circle API key
 *   CIRCLE_ENTITY_SECRET       — Circle entity secret
 *   CIRCLE_WALLET_ID           — Circle wallet ID
 *   CIRCLE_WALLET_ADDRESS      — Provider wallet address
 *   ARC_ERC8183_CONTRACT       — ERC-8183 contract address
 *   ARC_RPC_URL                — Arc RPC URL
 *   INDEXER_URL                — Local indexer
 *   ARCLAYER_AGENT_ID          — ERC-8004 tokenId
 *   OPENAI_API_KEY             — OpenAI API key for the LLM
 *   OPENAI_MODEL               — Optional LangChain model id, default openai:gpt-4o
 *   OPENAI_BASE_URL            — Optional custom base URL
 *   LIVE_MODE                  — "true" for production direct mode (default)
 *   PROVIDER_WRITE_MODE        — "direct" (default)
 *   PROVIDER_ALLOW_SET_BUDGET  — "true" to enable setBudget (default: false)
 *   LIVE_POLL_INTERVAL_MS      — Poll interval (default 30000)
 *   PROVIDER_LIVE_DRAIN_MODE   — If "true", log-only, no writes (default "false")
 *   TASK_POLL_INTERVAL_MS      — Legacy mode poll interval (default 30000)
 */

import { ChatOpenAI } from "@langchain/openai";
import { runLiveDriver } from "./live-driver.js";

// ── Config ──────────────────────────────────────────────────────────────

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "openai:gpt-4o";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "";
const TASK_POLL_INTERVAL_MS = Number.parseInt(
  process.env.TASK_POLL_INTERVAL_MS ?? "30000",
  10,
);

if (!Number.isFinite(TASK_POLL_INTERVAL_MS) || TASK_POLL_INTERVAL_MS < 1000) {
  console.error("TASK_POLL_INTERVAL_MS must be >= 1000");
  process.exit(1);
}

// ── State ───────────────────────────────────────────────────────────────

let shuttingDown = false;

// ── Helpers ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Legacy Worker Loop (no Runner, no on-chain writes) ──────────────────

async function workerLoop(): Promise<void> {
  console.log("[provider-agent] started (legacy mode — no on-chain writes)");
  console.log(`  model: ${OPENAI_MODEL}`);
  console.log(`  task source: none`);

  // In legacy mode, just idle. No Runner, no on-chain writes.
  // This mode is for testing the LLM service only.
  while (!shuttingDown) {
    console.log("[provider-agent] idle: legacy mode — use LIVE_MODE=true for production");
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

const LIVE_MODE = process.env.LIVE_MODE !== "false"; // default true

if (LIVE_MODE) {
  console.log("[provider-agent] LIVE_MODE=true — starting deterministic live-driver (direct mode)");
  console.log("[provider-agent]   no Runner dependency");
  runLiveDriver().catch((err) => {
    console.error("[live-driver] fatal:", err);
    process.exit(1);
  });
} else {
  console.log("[provider-agent] LIVE_MODE=false — starting legacy worker loop");
  workerLoop().catch((err) => {
    console.error("[provider-agent] fatal:", err);
    process.exit(1);
  });
}
