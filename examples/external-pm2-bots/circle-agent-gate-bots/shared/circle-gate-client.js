const { GatewayClient } = require("@circle-fin/x402-batching/client");
const { BASE_URL, getApiKey, getAgentId } = require("./arclayer-api");

function normalizePrivateKey(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("ISI_") || raw.includes("REPLACE")) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function getPrivateKey() {
  return normalizePrivateKey(process.env.X402_PAYER_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY);
}

async function payCircleAgentGate({
  category,
  role,
  scope,
  market,
  sessionId,
  runtimeId,
  payloadHash,
  payload,
  llmReceipt,
  route = process.env.CIRCLE_GATE_ROUTE || "/api/x402/circle-agent-gate",
}) {
  const apiKey = getApiKey();
  const agentId = getAgentId();
  const privateKey = getPrivateKey();

  if (!apiKey) throw new Error("Missing ARCLAYER_API_KEY");
  if (!agentId) throw new Error("Missing ARCLAYER_AGENT_ID");
  if (!privateKey) throw new Error("Missing X402_PAYER_PRIVATE_KEY");

  const body = {
    category,
    role,
    scope,
    market,
    sessionId,
    agentId,
    runtimeId,
    payloadHash,
    payload,
    llmReceipt,
  };

  const client = new GatewayClient({
    chain: process.env.X402_GATEWAY_CHAIN || "arcTestnet",
    privateKey,
    rpcUrl: process.env.ARC_RPC_URL || process.env.RPC_URL || undefined,
  });

  const result = await client.pay(`${BASE_URL}${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body,
  });

  const data = result.data || {};
  const txHash = data.txHash || data.transaction || result.txHash || result.transaction || null;

  return {
    ok: true,
    rail: "x402_circle_gateway",
    payer: client.address || null,
    amount: result.amount?.toString?.() || null,
    formattedAmount: result.formattedAmount || null,
    paymentId: data.paymentId || data.paymentResponse?.paymentId || null,
    transaction: txHash,
    txHash,
    sessionId: data.sessionId || sessionId,
    payloadHash: data.payloadHash || payloadHash,
    response: data,
  };
}

module.exports = {
  payCircleAgentGate,
};
