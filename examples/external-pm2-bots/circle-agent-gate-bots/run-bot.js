const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });

const { currentSessionId, sha256 } = require("./shared/hash");
const { buildLlmReceipt } = require("./shared/llm-receipt");
const { postBridgeEvent, postReceiptReference } = require("./shared/arclayer-api");
const { payCircleAgentGate } = require("./shared/circle-gate-client");

function readConfig() {
  const configPath = process.env.BOT_CONFIG || "bot.config.example.json";
  const fullPath = path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing bot config: ${fullPath}`);
  }

  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

async function main() {
  const config = readConfig();

  const category = process.env.AGENT_CATEGORY || config.category || "prediction-market-bots";
  const role = process.env.AGENT_ROLE || config.role || "executor";
  const scope = process.env.AGENT_SCOPE || process.env.X402_SCOPE || config.scope || "hft_session";
  const market = process.env.MARKET_ID || config.market || "btc-15m";
  const runtimeId = process.env.RUNTIME_ID || config.runtimeId || `circle-${role}-bot`;
  const sessionId = process.env.SESSION_ID || config.sessionId || currentSessionId(`${market}_${role}`);

  const payload = {
    ...(config.payload || {}),
    independent: true,
    category,
    role,
    scope,
    market,
    runtimeId,
    sessionId,
    createdAt: new Date().toISOString(),
  };

  const llmReceipt = buildLlmReceipt({
    payload,
    llmReceipt: config.llmReceipt || {},
    provider: process.env.LLM_PROVIDER,
    model: process.env.LLM_MODEL,
  });

  console.log(`[circle-bot] post event session=${sessionId} category=${category} role=${role} scope=${scope} market=${market}`);

  const event = await postBridgeEvent({
    sessionId,
    category,
    role,
    type: config.eventType || "circle_gate_intent",
    runtimeId,
    payload,
    metadata: {
      circleGate: true,
      scope,
      market,
    },
  });

  console.log(`[circle-bot] event posted session=${event.sessionId} payloadHash=${event.payloadHash}`);

  const paymentPayloadHash = sha256({
    eventPayloadHash: event.payloadHash,
    category,
    role,
    scope,
    market,
    sessionId: event.sessionId,
    runtimeId,
    llmReceipt,
  });

  console.log(`[circle-bot] pay circle gate session=${event.sessionId} payloadHash=${paymentPayloadHash}`);

  const payment = await payCircleAgentGate({
    category,
    role,
    scope,
    market,
    sessionId: event.sessionId,
    runtimeId,
    payloadHash: paymentPayloadHash,
    payload,
    llmReceipt,
  });

  console.log(`[circle-bot] paid rail=${payment.rail} tx=${payment.txHash || "n/a"} paymentId=${payment.paymentId || "n/a"}`);

  await postReceiptReference({
    sessionId: event.sessionId,
    category,
    role,
    runtimeId,
    payment,
    llmReceipt,
  });

  console.log(`[circle-bot] done session=${event.sessionId}`);
}

main().catch((err) => {
  console.error(`[circle-bot] failed: ${err.message}`);
  process.exitCode = 1;
});
