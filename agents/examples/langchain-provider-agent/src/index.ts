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
 *   OPENAI_MODEL            — Model string (default: openai:gpt-4o)
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
  model: process.env.OPENAI_MODEL ?? "openai:gpt-4o",
  runnerUrl: RUNNER_URL,
  runnerSecret: RUNNER_SECRET,
  // When auto-submit is disabled, remove run-and-submit from available tools.
  // This ensures the model cannot call it even if prompted to.
  deniedTools: ENABLE_AUTO_SUBMIT
    ? []
    : ["arclayer_provider_run_and_submit"],
});

const availableTools = ["arclayer_provider_run_only"];
if (ENABLE_AUTO_SUBMIT) {
  availableTools.push("arclayer_provider_run_and_submit");
}

console.log(`[provider-agent] started`);
console.log(`  runner: ${RUNNER_URL}`);
console.log(`  model: ${process.env.OPENAI_MODEL ?? "openai:gpt-4o"}`);
console.log(`  auto-submit: ${ENABLE_AUTO_SUBMIT}`);
console.log(`  tools: ${availableTools.join(", ")}`);

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
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
