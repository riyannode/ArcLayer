const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.join(process.cwd(), ".env") });

const { currentSessionId } = require("./shared/hash");
const { buildLlmReceipt } = require("./shared/llm-receipt");
const { postBridgeEvent, postReceiptReference } = require("./shared/arclayer-api");
const { processWithLlm } = require("./shared/llm-processor");

// ─── Config ──────────────────────────────────────────────────────────

const LLM_INTERVAL = 5 * 60 * 1000; // 5 minutes
const PUBLISH_INTERVAL = Math.floor(60_000 / 9); // ~6,667ms = 9x per minute

function readConfig() {
  const configPath = process.env.BOT_CONFIG || "bot.config.example.json";
  const fullPath = path.isAbsolute(configPath)
    ? configPath
    : path.join(process.cwd(), configPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing bot config: ${fullPath}`);
  }

  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function resolveEnv(config) {
  const role = "oracle";
  const market = process.env.MARKET_ID || config.market || "btc-15m";

  return {
    category: process.env.AGENT_CATEGORY || config.category || "prediction-market-bots",
    role,
    market,
    runtimeId: process.env.RUNTIME_ID || config.runtimeId || `circle-${role}-01`,
    sessionId:
      process.env.SESSION_ID ||
      config.sessionId ||
      currentSessionId(`${market}_${role}`),
  };
}

// ─── Cached LLM result ───────────────────────────────────────────────

let cachedLlmResult = null;
let lastLlmTime = 0;

async function getOrRefreshLlm(config, env) {
  const now = Date.now();
  if (cachedLlmResult && (now - lastLlmTime) < LLM_INTERVAL) {
    console.log(`[oracle] using cached LLM (${Math.round((LLM_INTERVAL - (now - lastLlmTime)) / 1000)}s until refresh)`);
    return cachedLlmResult;
  }

  console.log("[oracle] calling LLM...");
  cachedLlmResult = await processWithLlm({
    role: "oracle",
    upstreamData: null,
    config: env,
  });
  lastLlmTime = now;
  console.log(`[oracle] LLM done: signal=${cachedLlmResult.signal || "none"}`);
  return cachedLlmResult;
}

// ─── Publish one event ───────────────────────────────────────────────

async function publishOnce({ config, env, llmResult, iteration }) {
  const payload = {
    ...(config.payload || {}),
    independent: true,
    role: "oracle",
    market: env.market,
    runtimeId: env.runtimeId,
    sessionId: env.sessionId,
    signal: llmResult.signal || null,
    data: llmResult.data || null,
    iteration,
    createdAt: new Date().toISOString(),
  };

  const llmReceipt = buildLlmReceipt({
    payload,
    llmReceipt: {
      ...llmResult,
      summary:
        llmResult.summary ||
        `Oracle published market data for ${env.market}.`,
      decision: llmResult.decision || "PUBLISH_MARKET_DATA",
    },
  });

  const event = await postBridgeEvent({
    sessionId: env.sessionId,
    category: env.category,
    role: "oracle",
    type: "market_snapshot",
    runtimeId: env.runtimeId,
    payload,
    metadata: {
      commerceSeller: true,
      scope: "market_data",
      market: env.market,
      llmProvider: llmResult.provider || null,
      llmModel: llmResult.model || null,
      cached: iteration > 0,
    },
  });

  console.log(
    `[oracle] #${iteration} posted payloadHash=${event.payloadHash?.slice(0, 12)}...`
  );

  await postReceiptReference({
    sessionId: env.sessionId,
    category: env.category,
    role: env.role,
    runtimeId: env.runtimeId,
    payment: { paymentId: null, txHash: null, payloadHash: event.payloadHash },
    llmReceipt,
    rail: "x402_circle_commerce",
    source: "circle-commerce-bot",
  });

  return event;
}

// ─── Main loop ───────────────────────────────────────────────────────

async function main() {
  const config = readConfig();
  const env = resolveEnv(config);

  console.log(`[oracle-hi-freq] starting`);
  console.log(`  market:     ${env.market}`);
  console.log(`  session:    [redacted]`);
  console.log(`  LLM every:  5 min`);
  console.log(`  publish:    9x/min (~6.7s interval)`);

  let iteration = 0;

  // Main loop — publish 9x per minute
  while (true) {
    try {
      // Get LLM result (cached or fresh)
      const llmResult = await getOrRefreshLlm(config, env);

      // Publish event
      await publishOnce({ config, env, llmResult, iteration });
      iteration++;
    } catch (err) {
      console.error(`[oracle] error: ${err.message}`);
    }

    // Wait for next publish cycle
    await new Promise((r) => setTimeout(r, PUBLISH_INTERVAL));
  }
}

main().catch((err) => {
  console.error("[oracle-hi-freq] fatal:", err);
  process.exit(1);
});
