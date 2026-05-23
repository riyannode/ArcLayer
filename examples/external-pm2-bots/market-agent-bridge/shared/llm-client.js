const path = require("node:path");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });

function cleanJsonText(text) {
  return String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractJson(text) {
  const cleaned = cleanJsonText(text);

  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(cleaned.slice(first, last + 1));
  }

  throw new Error("LLM response is not valid JSON");
}

async function callLLM({ system, prompt, fallback, temperature = 0.1 }) {
  if ((process.env.USE_LLM || "true").toLowerCase() === "false") {
    return { ...fallback, llmUsed: false, llmSkipped: true, reason: "USE_LLM=false" };
  }
  const baseUrl = (process.env.LLM_BASE_URL || "").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || "";
  const apiKey = process.env.LLM_API_KEY || "";
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 30000);

  if (!baseUrl || !model || !apiKey || apiKey.includes("ISI_API_KEY")) {
    return {
      ...fallback,
      usedFallback: true,
      fallbackReason: "missing_llm_env"
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ]
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(`LLM returned ${res.status}: ${data.error?.message || data.message || "unknown"}`);
    }

    const content = data?.choices?.[0]?.message?.content || "";
    console.log("REASONING_START"); console.log(content); console.log("REASONING_END"); const parsed = extractJson(content);

    return {
      ...parsed,
      usedFallback: false,
      llmModel: model
    };
  } catch (err) {
    return {
      ...fallback,
      usedFallback: true,
      fallbackReason: err.message
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callLLM };
