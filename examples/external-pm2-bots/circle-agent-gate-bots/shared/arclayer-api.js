const { currentSessionId } = require("./hash");

const BASE_URL = (process.env.ARCLAYER_BASE_URL || process.env.ARCLAYER_API_URL || "https://arclayers.xyz").replace(/\/$/, "");

function getApiKey() {
  return String(process.env.ARCLAYER_API_KEY || process.env.ARCLAYER_AGENT_API_KEY || "").trim();
}

function getAgentId() {
  return String(process.env.ARCLAYER_AGENT_ID || process.env.AGENT_ID || "").trim();
}

function requireBotAuth() {
  const apiKey = getApiKey();
  const agentId = getAgentId();

  if (!apiKey) throw new Error("Missing ARCLAYER_API_KEY / ARCLAYER_AGENT_API_KEY");
  if (!agentId) throw new Error("Missing ARCLAYER_AGENT_ID / AGENT_ID");

  return { apiKey, agentId };
}

async function postBridgeEvent({
  sessionId,
  category,
  role,
  type,
  runtimeId,
  payload,
  metadata = {},
}) {
  const { apiKey, agentId } = requireBotAuth();

  const body = {
    sessionId: sessionId || currentSessionId(category || "circle"),
    agentId,
    category,
    role,
    type,
    payload,
    source: "independent-circle-x402-bot",
    dryRun: true,
    metadata: {
      ...metadata,
      runtimeId,
    },
  };

  const res = await fetch(`${BASE_URL}/api/agent-bridge/events`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.ok === false) {
    throw new Error(`postBridgeEvent failed: ${res.status} ${data.error || data.message || "unknown"}`);
  }

  const payloadHash =
    data.payloadHash ||
    data.payload_hash ||
    data.event?.payloadHash ||
    data.event?.payload_hash ||
    data.row?.payloadHash ||
    data.row?.payload_hash ||
    data.data?.payloadHash ||
    data.data?.payload_hash ||
    null;

  if (!payloadHash) {
    throw new Error("postBridgeEvent failed: response missing payloadHash");
  }

  return {
    ...data,
    sessionId: data.sessionId || data.session_id || body.sessionId,
    payloadHash,
  };
}

async function postReceiptReference({
  sessionId,
  category,
  role,
  runtimeId,
  payment,
  llmReceipt,
  rail = "x402_circle_gateway",
  source = "circle-agent-gate",
}) {
  return postBridgeEvent({
    sessionId,
    category,
    role,
    runtimeId,
    type: "receipt_reference",
    payload: {
      source,
      rail,
      paymentId: payment.paymentId || null,
      txHash: payment.txHash || payment.transaction || null,
      payloadHash: payment.payloadHash || null,
      llmReceipt,
    },
    metadata: {
      rail,
      source,
    },
  });
}

module.exports = {
  BASE_URL,
  getApiKey,
  getAgentId,
  requireBotAuth,
  postBridgeEvent,
  postReceiptReference,
};
