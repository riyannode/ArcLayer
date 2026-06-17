/**
 * Minimal PM2-compatible ERC-8183 provider agent.
 *
 * Uses @arclayer/langchain-adapter with role "provider".
 * External LLM API only — no local model, no autonomous submit by default.
 *
 * Environment:
 *   ARCLAYER_RUNNER_URL     — Runner HTTP URL (e.g. http://127.0.0.1:8787)
 *   ARCLAYER_RUNNER_SECRET  — Runner HMAC secret
 *   OPENAI_API_KEY          — OpenAI API key for the LLM
 *   ENABLE_AUTO_SUBMIT      — Set "true" to allow run-and-submit (default: false)
 */

import { createArcLayerLangChainAgent } from "@arclayer/langchain-adapter";

// ── Config ──────────────────────────────────────────────────────────────

const RUNNER_URL = process.env.ARCLAYER_RUNNER_URL ?? "http://127.0.0.1:8787";
const RUNNER_SECRET = process.env.ARCLAYER_RUNNER_SECRET;
const ENABLE_AUTO_SUBMIT = process.env.ENABLE_AUTO_SUBMIT === "true";

if (!RUNNER_SECRET) {
  console.error("ARCLAYER_RUNNER_SECRET is required");
  process.exit(1);
}

// ── Agent Setup ─────────────────────────────────────────────────────────

const agent = createArcLayerLangChainAgent({
  role: "provider",
  model: "openai:gpt-4o",
  runnerUrl: RUNNER_URL,
  runnerSecret: RUNNER_SECRET,
});

console.log(`[provider-agent] started`);
console.log(`  runner: ${RUNNER_URL}`);
console.log(`  auto-submit: ${ENABLE_AUTO_SUBMIT}`);
console.log(`  tools: provider_run_only${ENABLE_AUTO_SUBMIT ? ", provider_run_and_submit" : ""}`);

// ── Main Loop ───────────────────────────────────────────────────────────

async function main() {
  // Example: run a provider job via the agent
  // In production, this would be triggered by an external event (webhook, queue, etc.)
  const prompt = ENABLE_AUTO_SUBMIT
    ? "Run provider job and submit deliverable on-chain when complete."
    : "Run provider job using run-only. Do not submit on-chain.";

  const result = await agent.invoke({
    messages: [{ role: "user", content: prompt }],
  });

  console.log("[provider-agent] result:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("[provider-agent] fatal:", err);
  process.exit(1);
});
