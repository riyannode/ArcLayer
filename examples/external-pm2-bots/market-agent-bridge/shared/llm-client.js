/**
 * Shared LLM Inference Pipeline - Production
 */
require("dotenv").config();

function extractJson(text) {
  const cleaned = String(text || "").replace(/```json\s*/i, "").replace(/```\s*/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error("Invalid JSON response");
}

async function callLLM({ system, prompt, fallback, temperature = 0.1 }) {
  if (process.env.USE_LLM === "false") return { ...fallback, llmUsed: false };
  
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${process.env.LLM_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.LLM_MODEL,
        temperature,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }]
      })
    });
    const data = await res.json();
    return { ...extractJson(data?.choices?.[0]?.message?.content), llmModel: process.env.LLM_MODEL };
  } catch (err) {
    return { ...fallback, usedFallback: true, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callLLM };
