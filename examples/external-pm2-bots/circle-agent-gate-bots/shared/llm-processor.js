/**
 * Pluggable LLM processor.
 *
 * Each bot runs its own LLM logic independently.
 * Set LLM_MODULE_PATH to a custom module that exports:
 *   async function process({ role, upstreamData, config }): { decision, confidence, summary, ... }
 *
 * Without LLM_MODULE_PATH, data passes through as-is (no mock noise).
 */
const fs = require("node:fs");
const path = require("node:path");

let customProcessor = null;

function loadCustomProcessor() {
  if (customProcessor !== null) return customProcessor;
  const modulePath = process.env.LLM_MODULE_PATH;
  if (!modulePath) return null;

  try {
    const resolved = path.isAbsolute(modulePath) ? modulePath : path.join(process.cwd(), modulePath);
    if (!fs.existsSync(resolved)) {
      console.warn(`[llm] LLM_MODULE_PATH set but file not found: ${resolved}`);
      return null;
    }
    customProcessor = require(resolved);
    return customProcessor;
  } catch (err) {
    console.warn(`[llm] failed to load LLM_MODULE_PATH: ${err.message}`);
    return null;
  }
}

async function processWithLlm({ role, upstreamData, config }) {
  const processor = loadCustomProcessor();

  if (processor && typeof processor.process === "function") {
    return processor.process({ role, upstreamData, config });
  }

  // No custom LLM — passthrough identity. Bot still posts events,
  // but no AI processing happens. Drop your LLM module via LLM_MODULE_PATH.
  return {
    decision: "PASSTHROUGH",
    confidence: null,
    summary: `No LLM loaded for role=${role}. Set LLM_MODULE_PATH to enable AI processing.`,
    provider: process.env.LLM_PROVIDER || "none",
    model: process.env.LLM_MODEL || "none",
    latencyMs: 0,
    riskFlags: ["no_llm_loaded"],
  };
}

module.exports = { processWithLlm };
