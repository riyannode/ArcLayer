const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.join(process.cwd(), ".env") });

const { currentSessionId } = require("./shared/hash");
const { buildLlmReceipt } = require("./shared/llm-receipt");
const { postBridgeEvent, postReceiptReference, getApiKey } = require("./shared/arclayer-api");
const { readUpstreamEvents } = require("./shared/read-events");
const { processWithLlm } = require("./shared/llm-processor");
const { payUpstreamForAccess } = require("./shared/pay-upstream");
const { resolveCommerceRoute } = require("./shared/commerce-route-map");

// ─── Heartbeat ──────────────────────────────────────────────────────

async function postHeartbeat({ role, agentId, apiKey }) {
  const BASE_URL = (process.env.ARCLAYER_BASE_URL || "https://arclayers.xyz").replace(/\/+$/, "");
  try {
    const res = await fetch(`${BASE_URL}/api/a2a/presence`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId,
        agentName: agentId,
        status: "online",
        lastEventType: "heartbeat",
        lastEventSummary: `${role} cycle completed`,
      }),
    });
    if (!res.ok) {
      console.warn(`[${role}] heartbeat failed: ${res.status}`);
    } else {
      console.log(`[${role}] heartbeat posted`);
    }
  } catch (err) {
    console.warn(`[${role}] heartbeat error: ${err.message}`);
  }
}

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

  // Event graph routing — upstream role auto-resolved per role
  // External bots just set their ROLE and automatically read from the right upstream
  const EVENT_GRAPH_UPSTREAM = {
    oracle: null,                          // no upstream — data source
    analyzer: { role: "oracle" },          // reads from ANY oracle
    evaluator: { role: "oracle" },         // reads from ANY oracle
    executor: { role: "analyzer" },        // reads from ANY analyzer (fallback: evaluator)
  };

  const upstreamConfig = EVENT_GRAPH_UPSTREAM[role] || null;

  return {
    category: process.env.AGENT_CATEGORY || config.category || "prediction-market-bots",
    role,
    market,
    runtimeId: process.env.RUNTIME_ID || config.runtimeId || `circle-${role}-01`,
    sessionId:
      process.env.SESSION_ID ||
      config.sessionId ||
      currentSessionId(`${market}_${role}`),
    // Upstream: event graph auto-route (or manual override via env)
    upstreamRole: process.env.UPSTREAM_ROLE || config.upstreamRole || upstreamConfig?.role || null,
    upstreamAgentId: process.env.UPSTREAM_AGENT_ID || config.upstreamAgentId || null,
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
    `[oracle] event posted payloadHash=${event.payloadHash?.slice(0, 12)}...`
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

// ─── Routed role (analyzer / evaluator / executor) ──────────────────
// Each role reads upstream events by ROLE (not agent ID) — event graph.
// External bots just set their ROLE and auto-route to the right upstream.

async function runRoutedRole({ config, env }) {
  // 1. Read upstream events by ROLE (event graph, blocking)
  let upstreamData = null;
  let upstreamSource = null;
  let selectedUpstreamRole = null;

  if (env.upstreamRole) {
    // Executor fallback: try analyzer first, then evaluator
    const rolesToTry = env.role === "executor"
      ? [env.upstreamRole, "evaluator"].filter((r, i, a) => r && a.indexOf(r) === i)
      : [env.upstreamRole];

    for (const tryRole of rolesToTry) {
      console.log(`[${env.role}] reading upstream role=${tryRole} events...`);

      const { events } = await readUpstreamEvents({
        agentId: env.upstreamAgentId || null,  // P2 fix: respect override
        role: tryRole,
        category: env.category,
        limit: 5,
        filterType: eventTypeForRole(tryRole),
      });

      if (events.length) {
        upstreamData = events[0].payload;
        upstreamSource = events[0];
        selectedUpstreamRole = tryRole;  // P3 fix: track actual role
        console.log(
          `[${env.role}] upstream data found from ${events[0].agentId || events[0].runtimeId || tryRole} payloadHash=${events[0].payloadHash?.slice(0, 12)}...`
        );
        break;
      } else {
        console.log(`[${env.role}] no ${tryRole} events available`);
      }
    }

    if (!upstreamData) {
      // BLOCKING — no upstream data = can't proceed
      const tried = rolesToTry.join(" or ");
      console.log(`[${env.role}] BLOCKED: no ${tried} events available in event graph`);
      throw new Error(`[${env.role}] BLOCKED: no ${tried} events available. Upstream event not found.`);
    }
  }

  // P3 fix: route resolved AFTER fallback, using actual selected role
  const route = selectedUpstreamRole
    ? resolveCommerceRoute({ buyerRole: env.role, sellerRole: selectedUpstreamRole })
    : null;

  // 2. Process with LLM (requires upstream data for non-oracle roles)
  const llmResult = await processWithLlm({
    role: env.role,
    upstreamData,
    config: env,
  });

  // 3. Post purchase intent + pay upstream (best effort)
  let payment = { paymentId: null, txHash: null, payloadHash: null, rail: "skipped" };
  let purchaseIntentHash = null;

  if (upstreamData && route) {
    const skipPayment = process.env.X402_SKIP_PAYMENT === "true";

    try {
      const intent = await postBridgeEvent({
        sessionId: env.sessionId,
        category: env.category,
        role: env.role,
        type: "bridge_event",
        runtimeId: env.runtimeId,
        payload: {
          action: route.action,
          buyerRole: env.role,
          sellerRole: selectedUpstreamRole,
          sellerAgentId: upstreamSource?.agentId || upstreamSource?.runtimeId || null,
          sourcePayloadHash: upstreamSource?.payloadHash || null,
          market: env.market,
          createdAt: new Date().toISOString(),
        },
        metadata: {
          commerceBuyer: true,
          buyerRole: env.role,
          sellerRole: selectedUpstreamRole,
          sellerAgentId: upstreamSource?.agentId || upstreamSource?.runtimeId || null,
          accessType: route.accessType,
          scope: route.scope,
          market: env.market,
        },
      });
      purchaseIntentHash = intent.payloadHash;
      console.log(`[${env.role}] purchase intent posted payloadHash=${intent.payloadHash?.slice(0, 12)}...`);
    } catch (err) {
      console.warn(`[${env.role}] purchase intent skipped: ${err.message}`);
    }

    if (!skipPayment && purchaseIntentHash) {
      try {
        payment = await payUpstreamForAccess({
          upstreamAgentId: upstreamSource?.agentId || upstreamSource?.runtimeId || null,
          upstreamRole: selectedUpstreamRole,
          buyerRole: env.role,
          category: env.category,
          market: env.market,
          sessionId: env.sessionId,
          runtimeId: env.runtimeId,
          sourcePayloadHash: upstreamSource?.payloadHash || null,
          payload: {
            purchaseIntentHash,
            sourcePayloadHash: upstreamSource?.payloadHash,
            action: route.action,
          },
          llmReceipt: buildLlmReceipt({
            payload: { upstreamPayload: upstreamData, result: llmResult },
            llmReceipt: { ...llmResult, summary: llmResult.summary || `${env.role} consumed ${selectedUpstreamRole} data.`, decision: llmResult.decision || "COMMERCE_ACCESS" },
          }),
        });
        console.log(`[${env.role}] seller commerce paid rail=${payment.rail} tx=${payment.txHash || "n/a"}`);
      } catch (err) {
        console.warn(`[${env.role}] commerce payment skipped: ${err.message}`);
      }
    }
  }

  // 4. Build output payload
  const outputPayload = {
    ...(config.payload || {}),
    eventGraph: true,
    role: env.role,
    market: env.market,
    runtimeId: env.runtimeId,
    sessionId: env.sessionId,
    upstreamRole: selectedUpstreamRole,
    upstreamPayloadHash: upstreamSource?.payloadHash || null,
    analysis: llmResult.analysis || null,
    evaluation: llmResult.evaluation || null,
    execution: llmResult.execution || null,
    signal: llmResult.signal || null,
    data: llmResult.data || null,
    decision: llmResult.decision || null,
    confidence: llmResult.confidence ?? null,
    createdAt: new Date().toISOString(),
  };

  // 5. Post output event
  const outputEvent = await postBridgeEvent({
    sessionId: env.sessionId,
    category: env.category,
    role: env.role,
    type: eventTypeForRole(env.role),
    runtimeId: env.runtimeId,
    payload: outputPayload,
    metadata: {
      commerceOutput: true,
      eventGraph: true,
      buyerRole: env.role,
      sellerRole: selectedUpstreamRole,
      scope: route?.scope || "event_graph",
      market: env.market,
      llmProvider: llmResult.provider || null,
      llmModel: llmResult.model || null,
    },
  });

  console.log(`[${env.role}] output posted payloadHash=${outputEvent.payloadHash?.slice(0, 12)}...`);

  // 6. Post receipt
  const llmReceipt = buildLlmReceipt({
    payload: outputPayload,
    llmReceipt: {
      ...llmResult,
      summary: llmResult.summary || `${env.role} produced ${selectedUpstreamRole}-driven analysis for ${env.market}.`,
      decision: llmResult.decision || "PIPELINE_OUTPUT",
    },
  });

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
    await postHeartbeat({ role: env.role, agentId: config.agentId, apiKey: getApiKey() });
    console.log("[commerce-bot] oracle done");
    return;
  }

  if (["analyzer", "evaluator", "executor"].includes(env.role)) {
    const result = await runRoutedRole({ config, env });
    await postHeartbeat({ role: env.role, agentId: config.agentId, apiKey: getApiKey() });
    console.log(`[commerce-bot] ${env.role} done`);
    return;
  }

  throw new Error(`Unsupported AGENT_ROLE=${env.role}`);
}

main().catch((err) => {
  console.error(`[commerce-bot] failed: ${err.message}`);
  process.exit(1);
});
