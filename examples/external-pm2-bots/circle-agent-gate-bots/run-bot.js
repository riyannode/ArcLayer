const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });

const { currentSessionId, sha256 } = require("./shared/hash");
const { buildLlmReceipt } = require("./shared/llm-receipt");
const { postBridgeEvent, postReceiptReference } = require("./shared/arclayer-api");
const { payCircleAgentGate } = require("./shared/circle-gate-client");
const { readUpstreamEvents } = require("./shared/read-events");
const { processWithLlm } = require("./shared/llm-processor");
const { payUpstreamForAccess } = require("./shared/pay-upstream");

// ─── Config ───────────────────────────────────────────────────────────────────

function readConfig() {
  const configPath = process.env.BOT_CONFIG || "bot.config.example.json";
  const fullPath = path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath);
  if (!fs.existsSync(fullPath)) throw new Error(`Missing bot config: ${fullPath}`);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function resolveEnv(config) {
  return {
    category: process.env.AGENT_CATEGORY || config.category || "prediction-market-bots",
    role: process.env.AGENT_ROLE || config.role || "executor",
    scope: process.env.AGENT_SCOPE || process.env.X402_SCOPE || config.scope || "hft_session",
    market: process.env.MARKET_ID || config.market || "btc-15m",
    runtimeId: process.env.RUNTIME_ID || config.runtimeId || `circle-${config.role || "bot"}-01`,
    sessionId: process.env.SESSION_ID || config.sessionId || currentSessionId(`${config.market || "btc"}_${config.role || "bot"}`),
    upstreamAgentId: process.env.UPSTREAM_AGENT_ID || config.upstreamAgentId || null,
    upstreamRole: process.env.UPSTREAM_ROLE || config.upstreamRole || null,
  };
}

// ─── Role-specific flows ──────────────────────────────────────────────────────

async function runOracle({ config, env }) {
  // Oracle: generate data → post bridge event → (downstream pays to access)
  console.log(`[oracle] generating raw market data session=${env.sessionId}`);

  const llmResult = processWithLlm({ role: "oracle", upstreamData: null, config: env });
  const llmReceipt = buildLlmReceipt({ payload: llmResult, llmReceipt: llmResult });

  const payload = {
    ...(config.payload || {}),
    independent: true,
    role: "oracle",
    market: env.market,
    runtimeId: env.runtimeId,
    sessionId: env.sessionId,
    signal: llmResult.signal,
    createdAt: new Date().toISOString(),
  };

  const event = await postBridgeEvent({
    sessionId: env.sessionId,
    category: env.category,
    role: "oracle",
    type: "execution_intent",
    runtimeId: env.runtimeId,
    payload,
    metadata: { circleGate: true, scope: env.scope, market: env.market, llmProvider: llmResult.provider, llmModel: llmResult.model },
  });

  console.log(`[oracle] event posted session=${event.sessionId} payloadHash=${event.payloadHash}`);

  // Post receipt for traceability
  await postReceiptReference({
    sessionId: event.sessionId,
    category: env.category,
    role: "oracle",
    runtimeId: env.runtimeId,
    payment: { rail: "x402_circle_gateway", paymentId: null, txHash: null, payloadHash: event.payloadHash },
    llmReceipt,
  });

  console.log(`[oracle] done session=${event.sessionId} signal=${JSON.stringify(llmResult.signal)}`);
  return event;
}

async function runAnalyzer({ config, env }) {
  // Analyzer: read oracle → pay oracle → analyze → post result
  if (!env.upstreamAgentId || !env.upstreamRole) {
    throw new Error("Analyzer requires UPSTREAM_AGENT_ID and UPSTREAM_ROLE (the oracle)");
  }

  console.log(`[analyzer] reading upstream agentId=${env.upstreamAgentId} role=${env.upstreamRole}`);

  // 1. Read oracle events
  const { events } = await readUpstreamEvents({
    agentId: env.upstreamAgentId,
    role: env.upstreamRole,
    category: env.category,
    limit: 3,
  });

  if (events.length === 0) {
    console.log(`[analyzer] no upstream events found — skipping`);
    return null;
  }

  const latestEvent = events[0];
  console.log(`[analyzer] found ${events.length} events, latest payloadHash=${latestEvent.payloadHash}`);

  // 2. Pay oracle for data access
  const llmResult = processWithLlm({ role: "analyzer", upstreamData: latestEvent.payload, config: env });
  const llmReceipt = buildLlmReceipt({ payload: llmResult, llmReceipt: llmResult });

  const paymentPayloadHash = sha256({
    upstreamEventHash: latestEvent.payloadHash,
    buyerRole: "analyzer",
    sellerRole: env.upstreamRole,
    sessionId: env.sessionId,
    llmReceipt,
  });

  console.log(`[analyzer] paying oracle session=${env.sessionId}`);

  const payment = await payUpstreamForAccess({
    upstreamAgentId: env.upstreamAgentId,
    upstreamRole: env.upstreamRole,
    category: env.category,
    scope: env.scope,
    market: env.market,
    sessionId: env.sessionId,
    runtimeId: env.runtimeId,
    payloadHash: paymentPayloadHash,
    payload: { sourceEvent: latestEvent.payloadHash, action: "purchase_oracle_data" },
    llmReceipt,
  });

  console.log(`[analyzer] paid rail=${payment.rail} tx=${payment.txHash || "n/a"}`);

  // 3. Post analysis result
  const payload = {
    ...(config.payload || {}),
    independent: true,
    role: "analyzer",
    market: env.market,
    runtimeId: env.runtimeId,
    sessionId: env.sessionId,
    analysis: llmResult.analysis,
    upstreamEventHash: latestEvent.payloadHash,
    createdAt: new Date().toISOString(),
  };

  const event = await postBridgeEvent({
    sessionId: env.sessionId,
    category: env.category,
    role: "analyzer",
    type: "evaluation",
    runtimeId: env.runtimeId,
    payload,
    metadata: { circleGate: true, scope: env.scope, market: env.market, upstreamRole: env.upstreamRole, upstreamAgentId: env.upstreamAgentId, llmProvider: llmResult.provider, llmModel: llmResult.model },
  });

  console.log(`[analyzer] event posted session=${event.sessionId} payloadHash=${event.payloadHash}`);

  await postReceiptReference({
    sessionId: event.sessionId,
    category: env.category,
    role: "analyzer",
    runtimeId: env.runtimeId,
    payment,
    llmReceipt,
  });

  console.log(`[analyzer] done session=${event.sessionId} analysis=${JSON.stringify(llmResult.analysis)}`);
  return event;
}

async function runEvaluator({ config, env }) {
  // Evaluator: read analyzer → pay analyzer → evaluate → post result
  if (!env.upstreamAgentId || !env.upstreamRole) {
    throw new Error("Evaluator requires UPSTREAM_AGENT_ID and UPSTREAM_ROLE (the analyzer)");
  }

  console.log(`[evaluator] reading upstream agentId=${env.upstreamAgentId} role=${env.upstreamRole}`);

  const { events } = await readUpstreamEvents({
    agentId: env.upstreamAgentId,
    role: env.upstreamRole,
    category: env.category,
    limit: 3,
  });

  if (events.length === 0) {
    console.log(`[evaluator] no upstream events found — skipping`);
    return null;
  }

  const latestEvent = events[0];
  console.log(`[evaluator] found ${events.length} events, latest payloadHash=${latestEvent.payloadHash}`);

  const llmResult = processWithLlm({ role: "evaluator", upstreamData: latestEvent.payload, config: env });
  const llmReceipt = buildLlmReceipt({ payload: llmResult, llmReceipt: llmResult });

  const paymentPayloadHash = sha256({
    upstreamEventHash: latestEvent.payloadHash,
    buyerRole: "evaluator",
    sellerRole: env.upstreamRole,
    sessionId: env.sessionId,
    llmReceipt,
  });

  console.log(`[evaluator] paying analyzer session=${env.sessionId}`);

  const payment = await payUpstreamForAccess({
    upstreamAgentId: env.upstreamAgentId,
    upstreamRole: env.upstreamRole,
    category: env.category,
    scope: env.scope,
    market: env.market,
    sessionId: env.sessionId,
    runtimeId: env.runtimeId,
    payloadHash: paymentPayloadHash,
    payload: { sourceEvent: latestEvent.payloadHash, action: "purchase_analyzer_data" },
    llmReceipt,
  });

  console.log(`[evaluator] paid rail=${payment.rail} tx=${payment.txHash || "n/a"}`);

  const payload = {
    ...(config.payload || {}),
    independent: true,
    role: "evaluator",
    market: env.market,
    runtimeId: env.runtimeId,
    sessionId: env.sessionId,
    evaluation: llmResult.evaluation,
    decision: llmResult.decision,
    confidence: llmResult.confidence,
    upstreamEventHash: latestEvent.payloadHash,
    createdAt: new Date().toISOString(),
  };

  const event = await postBridgeEvent({
    sessionId: env.sessionId,
    category: env.category,
    role: "evaluator",
    type: "evaluation",
    runtimeId: env.runtimeId,
    payload,
    metadata: { circleGate: true, scope: env.scope, market: env.market, upstreamRole: env.upstreamRole, upstreamAgentId: env.upstreamAgentId, llmProvider: llmResult.provider, llmModel: llmResult.model },
  });

  console.log(`[evaluator] event posted session=${event.sessionId} payloadHash=${event.payloadHash} decision=${llmResult.decision}`);

  await postReceiptReference({
    sessionId: event.sessionId,
    category: env.category,
    role: "evaluator",
    runtimeId: env.runtimeId,
    payment,
    llmReceipt,
  });

  console.log(`[evaluator] done session=${event.sessionId}`);
  return event;
}

async function runExecutor({ config, env }) {
  // Executor: read evaluator → pay evaluator → execute → receipt
  if (!env.upstreamAgentId || !env.upstreamRole) {
    throw new Error("Executor requires UPSTREAM_AGENT_ID and UPSTREAM_ROLE (the evaluator)");
  }

  console.log(`[executor] reading upstream agentId=${env.upstreamAgentId} role=${env.upstreamRole}`);

  const { events } = await readUpstreamEvents({
    agentId: env.upstreamAgentId,
    role: env.upstreamRole,
    category: env.category,
    limit: 3,
  });

  if (events.length === 0) {
    console.log(`[executor] no upstream events found — skipping`);
    return null;
  }

  const latestEvent = events[0];
  console.log(`[executor] found ${events.length} events, latest payloadHash=${latestEvent.payloadHash} decision=${latestEvent.payload?.decision}`);

  // Only execute if evaluator approved
  if (latestEvent.payload?.decision !== "APPROVE") {
    console.log(`[executor] evaluator rejected (decision=${latestEvent.payload?.decision}) — skipping execution`);
    return null;
  }

  const llmResult = processWithLlm({ role: "executor", upstreamData: latestEvent.payload, config: env });
  const llmReceipt = buildLlmReceipt({ payload: llmResult, llmReceipt: llmResult });

  const paymentPayloadHash = sha256({
    upstreamEventHash: latestEvent.payloadHash,
    buyerRole: "executor",
    sellerRole: env.upstreamRole,
    sessionId: env.sessionId,
    llmReceipt,
  });

  console.log(`[executor] paying evaluator session=${env.sessionId}`);

  const payment = await payUpstreamForAccess({
    upstreamAgentId: env.upstreamAgentId,
    upstreamRole: env.upstreamRole,
    category: env.category,
    scope: env.scope,
    market: env.market,
    sessionId: env.sessionId,
    runtimeId: env.runtimeId,
    payloadHash: paymentPayloadHash,
    payload: { sourceEvent: latestEvent.payloadHash, action: "purchase_evaluator_data" },
    llmReceipt,
  });

  console.log(`[executor] paid rail=${payment.rail} tx=${payment.txHash || "n/a"}`);

  const payload = {
    ...(config.payload || {}),
    independent: true,
    role: "executor",
    market: env.market,
    runtimeId: env.runtimeId,
    sessionId: env.sessionId,
    execution: llmResult.execution,
    decision: llmResult.decision,
    upstreamEventHash: latestEvent.payloadHash,
    createdAt: new Date().toISOString(),
  };

  const event = await postBridgeEvent({
    sessionId: env.sessionId,
    category: env.category,
    role: "executor",
    type: "execution_intent",
    runtimeId: env.runtimeId,
    payload,
    metadata: { circleGate: true, scope: env.scope, market: env.market, upstreamRole: env.upstreamRole, upstreamAgentId: env.upstreamAgentId, llmProvider: llmResult.provider, llmModel: llmResult.model },
  });

  console.log(`[executor] event posted session=${event.sessionId} payloadHash=${event.payloadHash}`);

  await postReceiptReference({
    sessionId: event.sessionId,
    category: env.category,
    role: "executor",
    runtimeId: env.runtimeId,
    payment,
    llmReceipt,
  });

  console.log(`[executor] done session=${event.sessionId} action=${llmResult.execution?.action}`);
  return event;
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

const ROLE_HANDLERS = {
  oracle: runOracle,
  analyzer: runAnalyzer,
  evaluator: runEvaluator,
  executor: runExecutor,
};

async function main() {
  const config = readConfig();
  const env = resolveEnv(config);

  const handler = ROLE_HANDLERS[env.role];
  if (!handler) {
    throw new Error(`Unknown role: ${env.role}. Must be one of: ${Object.keys(ROLE_HANDLERS).join(", ")}`);
  }

  console.log(`[${env.role}] starting`);
  await handler({ config, env });
  console.log(`[${env.role}] finished`);
}

main().catch((err) => {
  console.error(`[circle-bot] failed: ${err.message}`);
  process.exitCode = 1;
});
