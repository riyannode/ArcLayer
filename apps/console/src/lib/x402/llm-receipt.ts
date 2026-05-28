export type SanitizedLlmReceipt = {
  summary: string;
  model: string;
  provider: string | null;
  decision: string;
  confidence: number | null;
  inputHash: string | null;
  outputHash: string | null;
  reasoningHash: string | null;
  riskFlags: string[];
  latencyMs: number | null;
};

function cleanString(value: unknown, max = 500): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function cleanHash(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^0x[a-fA-F0-9]{64}$/.test(trimmed) ? trimmed : null;
}

function cleanNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanConfidence(value: unknown): number | null {
  const n = cleanNumber(value);
  if (n === null) return null;
  return Math.max(0, Math.min(1, n));
}

function cleanStringArray(value: unknown, maxItems = 12, maxLen = 80): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanString(item, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function sanitizeLlmReceipt(input: unknown):
  | { ok: true; receipt: SanitizedLlmReceipt | null }
  | { ok: false; error: string; message: string } {
  if (input === undefined || input === null) {
    return { ok: true, receipt: null };
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      error: 'invalid_llm_receipt',
      message: 'llmReceipt must be an object when provided.',
    };
  }

  const raw = input as Record<string, unknown>;
  const summary = cleanString(raw.summary, 1200);

  if (!summary) {
    return {
      ok: false,
      error: 'invalid_llm_receipt_summary',
      message: 'llmReceipt.summary is required when llmReceipt is provided.',
    };
  }

  return {
    ok: true,
    receipt: {
      summary,
      model: cleanString(raw.model, 100) || 'unknown',
      provider: cleanString(raw.provider, 100) || null,
      decision: cleanString(raw.decision, 80) || 'UNKNOWN',
      confidence: cleanConfidence(raw.confidence),
      inputHash: cleanHash(raw.inputHash),
      outputHash: cleanHash(raw.outputHash),
      reasoningHash: cleanHash(raw.reasoningHash),
      riskFlags: cleanStringArray(raw.riskFlags),
      latencyMs: cleanNumber(raw.latencyMs),
    },
  };
}
