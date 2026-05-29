/**
 * Commerce route map — maps buyer+role → seller+role to scope/accessType.
 * This is a pure lookup table. It is NOT a pipeline controller.
 *
 * Why? So bots don't use the wrong scope.
 *   Oracle → must be paid with market_data, not hft_session.
 *   Analyzer → must be paid with analysis.
 *   Evaluator → must be paid with evaluation.
 */

function resolveCommerceRoute({ buyerRole, sellerRole }) {
  const buyer = String(buyerRole || "").trim();
  const seller = String(sellerRole || "").trim();

  // ── Pipeline routes: buyer pays seller ────────────────────────

  if (buyer === "analyzer" && seller === "oracle") {
    return {
      scope: "market_data",
      accessType: "oracle_data",
      action: "purchase_oracle_data",
      eventType: "bridge_event",
    };
  }

  if (buyer === "evaluator" && seller === "oracle") {
    return {
      scope: "market_data",
      accessType: "oracle_data",
      action: "purchase_oracle_data",
      eventType: "bridge_event",
    };
  }

  if (buyer === "executor" && seller === "analyzer") {
    return {
      scope: "analysis",
      accessType: "analysis",
      action: "purchase_analysis",
      eventType: "bridge_event",
    };
  }

  if (buyer === "executor" && seller === "evaluator") {
    return {
      scope: "evaluation",
      accessType: "evaluation",
      action: "purchase_evaluation",
      eventType: "bridge_event",
    };
  }

  // ── Legacy routes (kept for backward compat) ──────────────────

  if (buyer === "evaluator" && seller === "analyzer") {
    return {
      scope: "analysis",
      accessType: "analysis",
      action: "purchase_analysis",
      eventType: "bridge_event",
    };
  }

  throw new Error(`Unsupported commerce route: ${buyer} pays ${seller}`);
}

module.exports = {
  resolveCommerceRoute,
};
