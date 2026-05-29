const { paySellerCommerceGate } = require("./seller-commerce-client");
const { resolveCommerceRoute } = require("./commerce-route-map");

/**
 * Pay upstream seller through commerce gate.
 *
 * Resolves scope/accessType from buyerRole + sellerRole mapping,
 * then calls /api/x402/agent-commerce-gate with x402 Circle Gateway settlement.
 */
async function payUpstreamForAccess({
  upstreamAgentId,
  upstreamRole,
  buyerRole,
  category = "prediction-market-bots",
  market = "btc-15m",
  sessionId,
  runtimeId,
  sourcePayloadHash,
  payload,
  llmReceipt,
}) {
  if (!upstreamAgentId || !upstreamRole || !buyerRole || !sessionId || !sourcePayloadHash) {
    const missing = [];
    if (!upstreamAgentId) missing.push("upstreamAgentId");
    if (!upstreamRole) missing.push("upstreamRole");
    if (!buyerRole) missing.push("buyerRole");
    if (!sessionId) missing.push("sessionId");
    if (!sourcePayloadHash) missing.push("sourcePayloadHash");
    console.warn(`[pay-upstream] skipping — missing: ${missing.join(", ")} | debug: agentId=${upstreamAgentId} srcHash=${String(sourcePayloadHash).slice(0,12)}`);
    return { paymentId: null, txHash: null, payloadHash: null, rail: "skipped" };
  }

  const route = resolveCommerceRoute({
    buyerRole,
    sellerRole: upstreamRole,
  });

  return paySellerCommerceGate({
    sellerAgentId: upstreamAgentId,
    sellerRole: upstreamRole,
    buyerRole,
    category,
    scope: route.scope,
    market,
    sessionId,
    runtimeId,
    payloadHash: sourcePayloadHash,
    accessType: route.accessType,
    payload: {
      ...(payload || {}),
      action: route.action,
      sourcePayloadHash,
      sellerAgentId: upstreamAgentId,
      sellerRole: upstreamRole,
      buyerRole,
    },
    llmReceipt,
  });
}

module.exports = {
  payUpstreamForAccess,
};
