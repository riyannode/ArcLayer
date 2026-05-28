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
  if (!upstreamAgentId) throw new Error("Missing upstreamAgentId");
  if (!upstreamRole) throw new Error("Missing upstreamRole");
  if (!buyerRole) throw new Error("Missing buyerRole");
  if (!sessionId) throw new Error("Missing sessionId");
  if (!sourcePayloadHash) throw new Error("Missing sourcePayloadHash");

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
