const { getApiKey, getAgentId } = require("./arclayer-api");
const { payCircleAgentGate } = require("./circle-gate-client");

/**
 * Pay an upstream agent for data access via Circle Gateway x402.
 *
 * Downstream bot pays upstream seller:
 * - Analyzer pays Oracle
 * - Evaluator pays Analyzer
 * - Executor pays Evaluator
 *
 * Each payment is an independent Circle Gateway x402 transaction.
 */
async function payUpstreamForAccess({
  upstreamAgentId,
  upstreamRole,
  category = "prediction-market-bots",
  scope = "hft_session",
  market,
  sessionId,
  runtimeId,
  payloadHash,
  payload,
  llmReceipt,
}) {
  const apiKey = getApiKey();
  const agentId = getAgentId(); // this bot's agentId (the buyer)

  if (!apiKey) throw new Error("Missing ARCLAYER_API_KEY");
  if (!agentId) throw new Error("Missing ARCLAYER_AGENT_ID");

  // Pay the upstream agent via Circle Gateway
  // The upstream agentId is passed in the payload so the backend
  // knows which agent's data is being purchased
  const result = await payCircleAgentGate({
    category,
    role: upstreamRole,
    scope,
    market,
    sessionId,
    runtimeId,
    payloadHash,
    payload: {
      ...(payload || {}),
      buyerAgentId: agentId,
      sellerAgentId: upstreamAgentId,
      accessType: "data_purchase",
      timestamp: new Date().toISOString(),
    },
    llmReceipt,
  });

  return result;
}

module.exports = {
  payUpstreamForAccess,
};
