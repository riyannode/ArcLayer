const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.join(process.cwd(), ".env") });

const { currentSessionId } = require("./shared/hash");
const { buildLlmReceipt } = require("./shared/llm-receipt");
const { postBridgeEvent, postReceiptReference } = require("./shared/arclayer-api");
const { readUpstreamEvents } = require("./shared/read-events");
const { processWithLlm } = require("./shared/llm-processor");
const { payUpstreamForAccess } = require("./shared/pay-upstream");
const { resolveCommerceRoute } = require("./shared/commerce-route-map");

// ─── Config ──────────────────────────────────────────────────────────

const LLM_INTERVAL = 5 * 60 * 1000; // 5 minutes
const PAY_INTERVAL = 60_000; // 1x per minute

function eventTypeForRole(role) {
  if (role === "oracle") return "market_snapshot";
  if (role === "analyzer") return "resolver_output";
  if (role === "evaluator") return "evaluation";
  if (role === "executor") return "execution_intent";
  return "bridge_event";
}

// ─── Cached LLM result ───────────────────────────────────────────────

let cachedLlmResult = null;
let lastLlmTime = 0;

async function getOrRefreshLlm(config, env) {
  const now = Date.now();
  if (cachedLlmResult && (now - lastLlmTime) < LLM_INTERVAL) {
    console.log(`[${env.role}] using cached LLM (${Math.round((LLM_INTERVAL - (now - lastLlmTime)) / 1000)}s until refresh)`);
    return cachedLlmResult;
  }

  // Read fresh upstream data
  console.log(`[${env.role}] reading upstream...`);
  const { events } = await readUpstreamEvents({
    agentId: env.upstreamAgentId,
    role: env.upstreamRole,
    category: env.category,
    limit: 3,
    filterType: eventTypeForRole(env.upstreamRole) === "market_snapshot" ? "market_snapshot" : eventTypeForRole(env.upstreamRole),
  });

  const upstreamData = events.length ? (events[0]?.payload || events[0] || {}) : { mock: true, signal: "NEUTRAL" };
  const upstreamPayloadHash = events[0]?.payloadHash || null;

  // Call LLM
  console.log(`[${env.role}] calling LLM...`);
  cachedLlmResult = await processWithLlm({
    role: env.role,
    upstreamData,
    config: env,
  });
  cachedLlmResult.upstreamPayloadHash = upstreamPayloadHash;
  lastLlmTime = now;
  console.log(`[${env.role}] LLM done: signal=${cachedLlmResult.signal || "none"}`);

  return cachedLlmResult;
}

// ─── Pay + publish one cycle ─────────────────────────────────────────

async function payAndPublish({ config, env, llmResult, iteration }) {
  // Generate unique session per iteration to avoid "already_paid"
  const sessionId = `${env.market}_${env.role}_hifreq_${Date.now()}_${iteration}`;

  // Create bridge event first (required for commerce gate)
  const payload = {
    ...(config.payload || {}),
    independent: true,
    role: env.role,
    market: env.market,
    runtimeId: env.runtimeId,
    sessionId,
    signal: llmResult.signal || null,
    data: llmResult.data || null,
    iteration,
    createdAt: new Date().toISOString(),
  };

  const bridgeResult = await postBridgeEvent({
    sessionId,
    category: env.category,
    role: env.role,
    type: eventTypeForRole(env.role),
    runtimeId: env.runtimeId,
    payload,
    metadata: {
      commerceBuyer: true,
      market: env.market,
      cached: iteration > 0,
    },
  });

  const realPayloadHash = bridgeResult.payloadHash;

  // Priority: upstream event hash > bridge event hash > synthetic (stress only)
  const sourcePayloadHash = process.env.STRESS_MODE === "true"
    ? `0x${env.role}${Date.now().toString(16)}${iteration.toString(16).padStart(4, "0")}`
    : (llmResult.upstreamPayloadHash || realPayloadHash);

  // Pay upstream (pass llmReceipt for commerce gate requirement)
  await payUpstreamForAccess({
    upstreamAgentId: env.upstreamAgentId,
    upstreamRole: env.upstreamRole,
    buyerRole: env.role,
    category: env.category,
    market: env.market,
    sessionId,
    runtimeId: env.runtimeId,
    sourcePayloadHash,
    payload: { hiFreq: true, iteration, timestamp: new Date().toISOString() },
    llmReceipt: {
      summary: llmResult.summary || `${env.role} analysis for ${env.market}`,
      signal: llmResult.signal || null,
      decision: llmResult.decision || `PUBLISH_${env.role.toUpperCase()}`,
      confidence: llmResult.confidence || 0.5,
    },
  });

  console.log(`[${env.role}] #${iteration} paid upstream (session=${sessionId.slice(-20)}...)`);

  // Post receipt
  const llmReceipt = buildLlmReceipt({
    payload,
    llmReceipt: {
      ...llmResult,
      summary: llmResult.summary || `${env.role} processed market data for ${env.market}.`,
      decision: llmResult.decision || `PUBLISH_${env.role.toUpperCase()}`,
    },
  });

  await postReceiptReference({
    sessionId,
    category: env.category,
    role: env.role,
    runtimeId: env.runtimeId,
    payment: { paymentId: null, txHash: null, payloadHash: null },
    llmReceipt,
    rail: "x402_circle_commerce",
    source: "circle-commerce-bot",
  });

  return { sessionId };
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const configPath = process.env.BOT_CONFIG || "bot.config.example.json";
  const fullPath = path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath);
  const config = JSON.parse(fs.readFileSync(fullPath, "utf8"));

  const role = process.env.AGENT_ROLE || config.role;
  const market = process.env.MARKET_ID || config.market || "btc-15m";

  const env = {
    category: process.env.AGENT_CATEGORY || config.category || "prediction-market-bots",
    role,
    market,
    runtimeId: process.env.RUNTIME_ID || config.runtimeId || `circle-${role}-01`,
    upstreamAgentId: process.env.UPSTREAM_AGENT_ID || config.upstreamAgentId,
    upstreamRole: process.env.UPSTREAM_ROLE || config.upstreamRole,
  };

  console.log(`[${role}-hi-freq] starting`);
  console.log(`  market:     ${market}`);
  console.log(`  upstream:   ${env.upstreamAgentId} (${env.upstreamRole})`);
  console.log(`  LLM every:  5 min`);
  console.log(`  pay:        1x/min (60s interval)`);

  let iteration = 0;

  while (true) {
    try {
      const llmResult = await getOrRefreshLlm(config, env);
      await payAndPublish({ config, env, llmResult, iteration });
      iteration++;
    } catch (err) {
      console.error(`[${role}] error: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, PAY_INTERVAL));
  }
}

main().catch((err) => {
  console.error("[buyer-hi-freq] fatal:", err);
  process.exit(1);
});
