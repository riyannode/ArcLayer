const { sha256 } = require("./hash");

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 1) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

function buildLlmReceipt({ payload = {}, llmReceipt = {}, model, provider }) {
  const summary =
    llmReceipt.summary ||
    payload.summary ||
    "Independent Circle x402 bot produced a receipt summary.";

  const decision =
    llmReceipt.decision ||
    payload.decision ||
    payload.action ||
    "UNKNOWN";

  const output = {
    decision,
    confidence: llmReceipt.confidence ?? payload.confidence ?? null,
    riskFlags: Array.isArray(llmReceipt.riskFlags) ? llmReceipt.riskFlags : [],
  };

  return {
    summary: String(summary).slice(0, 1200),
    provider: String(llmReceipt.provider || provider || process.env.LLM_PROVIDER || "unknown").slice(0, 100),
    model: String(llmReceipt.model || model || process.env.LLM_MODEL || "unknown").slice(0, 100),
    decision: String(decision).slice(0, 80),
    confidence: clampConfidence(llmReceipt.confidence ?? payload.confidence),
    inputHash: sha256(payload),
    outputHash: sha256(output),
    reasoningHash: sha256({ summary, decision }),
    riskFlags: Array.isArray(llmReceipt.riskFlags) ? llmReceipt.riskFlags.slice(0, 12) : [],
    latencyMs: Number.isFinite(Number(llmReceipt.latencyMs)) ? Number(llmReceipt.latencyMs) : null,
  };
}

module.exports = {
  buildLlmReceipt,
};
