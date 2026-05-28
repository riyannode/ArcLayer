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
  const role = process.env.AGENT_ROLE || config.role || "executor";
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
    upstreamAgentId: process.env.UPSTREAM_AGENT_ID || config.upstreamAgentId || null,
    upstreamRole: process.env.UPSTREAM_ROLE || config.upstreamRole || null,
  };
}

// ─── Event type per role ─────────────────────────────────────────────

function eventTypeForRole(role) {
  if (role === "oracle") return "market_snapshot";
  if (role === "analyzer") return "resolver_output";
  if (role === "evaluator") return "evaluation";
  if (role === "executor") return "execution_intent";
  return "bridge_event";
}

// ─── Oracle (publisher — no upstream) ─────────────────────────────────

async function runOracle({ config, env }) {
  const llmResult = await processWithLlm({
    role: "oracle",
    upstreamData: null,
    config: env,
  });

  const payload = {
    ...(config.payload || {}),
    independent: true,
    role: "oracle",
    market: env.market,
    runtimeId: env.runtimeId,
    sessionId: env.sessionId,
    signal: llmResult.signal || null,
    data: llmResult.data || null,
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
    type: eventTypeForRole("oracle"),
    runtimeId: env.runtimeId,
    payload,
    metadata: {
      commerceSeller: true,
      scope: "market_data",
      market: env.market,
      llmProvider: llmResult.provider || null,
      llmModel: llmResult.model || null,
    },
  });

  console.log(
    `[oracle] event posted sessionId=${env.sessionId?.slice(0, 16)}... payloadHash=${event.payloadHash?.slice(0, 12)}...`
  );

  // Oracle publishes + posts receipt (no payment to upstream)
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

  console.log("[oracle] receipt posted");
  return event;
}

// ─── Buyer roles (analyzer / evaluator / executor) ───────────────────

async function runBuyerRole({ config, env }) {
  if (!env.upstreamAgentId || !env.upstreamRole) {
    throw new Error(`${env.role} requires UPSTREAM_AGENT_ID and UPSTREAM_ROLE`);
  }

  const route = resolveCommerceRoute({
    buyerRole: env.role,
    sellerRole: env.upstreamRole,
  });

  // 1. Read upstream events — filter to seller's output type only,
  //    not their purchase intents (bridge_event). Without this, a
  //    buyer that starts right after the seller posts its purchase
  //    intent but before its output is posted would process + pay
  //    for the intent payload instead of the actual analysis.
  const { events } = await readUpstreamEvents({
    agentId: env.upstreamAgentId,
    role: env.upstreamRole,
    category: env.category,
    limit: 3,
    filterType: eventTypeForRole(env.upstreamRole),
  });

  if (!events.length) {
    console.log(`[${env.role}] no upstream events found`);
    return null;
  }

  const latestEvent = events[0];
  console.log(
    `[${env.role}] upstream event found payloadHash=${latestEvent.payloadHash?.slice(0, 12)}...`
  );

  // 2. Process with LLM
  const llmResult = await processWithLlm({
    role: env.role,
    upstreamData: latestEvent.payload,
    config: env,
  });

  // 3. Post purchase intent (required by backend before paying)
  const purchasePayload = {
    action: route.action,
    buyerRole: env.role,
    sellerRole: env.upstreamRole,
    sellerAgentId: env.upstreamAgentId,
    sourcePayloadHash: latestEvent.payloadHash,
    market: env.market,
    createdAt: new Date().toISOString(),
  };

  const intent = await postBridgeEvent({
    sessionId: env.sessionId,
    category: env.category,
    role: env.role,
    type: "bridge_event",
    runtimeId: env.runtimeId,
    payload: purchasePayload,
    metadata: {
      commerceBuyer: true,
      buyerRole: env.role,
      sellerRole: env.upstreamRole,
      sellerAgentId: env.upstreamAgentId,
      accessType: route.accessType,
      scope: route.scope,
      market: env.market,
    },
  });

  console.log(
    `[${env.role}] purchase intent posted payloadHash=${intent.payloadHash?.slice(0, 12)}...`
  );

  // 4. Build LLM receipt
  const llmReceipt = buildLlmReceipt({
    payload: {
      upstreamPayload: latestEvent.payload,
      result: llmResult,
      purchaseIntentHash: intent.payloadHash,
    },
    llmReceipt: {
      ...llmResult,
      summary:
        llmResult.summary ||
        `${env.role} consumed ${env.upstreamRole} output and produced ${route.accessType}.`,
      decision: llmResult.decision || "COMMERCE_ACCESS",
    },
  });

  // 5. Pay seller through commerce gate (non-fatal — skips if X402_SKIP_PAYMENT=true or on failure)
  let payment = null;
  const skipPayment = process.env.X402_SKIP_PAYMENT === "true";

  if (!skipPayment) {
    try {
      payment = await payUpstreamForAccess({
        upstreamAgentId: env.upstreamAgentId,
        upstreamRole: env.upstreamRole,
        buyerRole: env.role,
        category: env.category,
        market: env.market,
        sessionId: intent.sessionId,
        runtimeId: env.runtimeId,
        sourcePayloadHash: latestEvent.payloadHash,
        payload: {
          purchaseIntentHash: intent.payloadHash,
          sourceEvent: latestEvent.payloadHash,
          action: route.action,
        },
        llmReceipt,
      });
      console.log(
        `[${env.role}] seller commerce paid rail=${payment.rail} tx=${payment.txHash || "n/a"}`
      );
    } catch (err) {
      console.warn(
        `[${env.role}] commerce payment skipped: ${err.message}`
      );
      payment = { paymentId: null, txHash: null, payloadHash: null, rail: "skipped" };
    }
  } else {
    console.log(`[${env.role}] commerce payment skipped (X402_SKIP_PAYMENT=true)`);
    payment = { paymentId: null, txHash: null, payloadHash: null, rail: "skipped" };
  }

  // 6. Post output event
  const outputPayload = {
    ...(config.payload || {}),
    independent: true,
    role: env.role,
    market: env.market,
    runtimeId: env.runtimeId,
    sessionId: intent.sessionId,
    upstreamEventHash: latestEvent.payloadHash,
    purchaseIntentHash: intent.payloadHash,
    paymentPayloadHash: payment.payloadHash || null,
    analysis: llmResult.analysis || null,
    evaluation: llmResult.evaluation || null,
    execution: llmResult.execution || null,
    decision: llmResult.decision || null,
    confidence: llmResult.confidence ?? null,
    createdAt: new Date().toISOString(),
  };

  const outputEvent = await postBridgeEvent({
    sessionId: intent.sessionId,
    category: env.category,
    role: env.role,
    type: eventTypeForRole(env.role),
    runtimeId: env.runtimeId,
    payload: outputPayload,
    metadata: {
      commerceOutput: true,
      buyerRole: env.role,
      sellerRole: env.upstreamRole,
      sellerAgentId: env.upstreamAgentId,
      accessType: route.accessType,
      scope: route.scope,
      market: env.market,
      llmProvider: llmResult.provider || null,
      llmModel: llmResult.model || null,
    },
  });

  console.log(
    `[${env.role}] output posted payloadHash=${outputEvent.payloadHash?.slice(0, 12)}...`
  );

  // 7. Post receipt reference
  await postReceiptReference({
    sessionId: outputEvent.sessionId,
    category: env.category,
    role: env.role,
    runtimeId: env.runtimeId,
    payment,
    llmReceipt,
    rail: "x402_circle_commerce",
    source: "circle-commerce-bot",
  });

  console.log(`[${env.role}] receipt posted`);
  return outputEvent;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const config = readConfig();
  const env = resolveEnv(config);

  console.log(
    `[commerce-bot] start role=${env.role} market=${env.market} runtime=${env.runtimeId}`
  );

  if (env.role === "oracle") {
    await runOracle({ config, env });
    console.log("[commerce-bot] oracle done");
    return;
  }

  if (["analyzer", "evaluator", "executor"].includes(env.role)) {
    const result = await runBuyerRole({ config, env });
    if (!result) {
      console.log(`[commerce-bot] ${env.role} skipped — no upstream events`);
    } else {
      console.log(`[commerce-bot] ${env.role} done`);
    }
    return;
  }

  throw new Error(`Unsupported AGENT_ROLE=${env.role}`);
}

main().catch((err) => {
  console.error(`[commerce-bot] failed: ${err.message}`);
  process.exit(1);
});
