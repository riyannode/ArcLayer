import { stablePayloadHash } from "@/lib/agent-bridge/store";
import { normalizeGateSlug } from "@/lib/x402/circle-agent-policy";

export type AgentCommerceRolePolicy = {
  scopes: string[];
  markets?: string[];
  sellsAccessTypes: string[];
  amountAtomic?: string;
  reputationEligible?: boolean;
  llmReceiptRequired?: boolean;
};

export type AgentCommerceCategoryPolicy = {
  label: string;
  defaultAmountAtomic: string;
  roles: Record<string, AgentCommerceRolePolicy>;
};

export const AGENT_COMMERCE_POLICIES: Record<
  string,
  AgentCommerceCategoryPolicy
> = {
  "prediction-market-bots": {
    label: "Prediction Market Commerce",
    defaultAmountAtomic: "1",
    roles: {
      oracle: {
        scopes: ["market_data", "feed_snapshot", "candles", "orderbook"],
        markets: ["*"],
        sellsAccessTypes: [
          "oracle_data",
          "market_data",
          "candles",
          "orderbook",
        ],
        reputationEligible: true,
        llmReceiptRequired: false,
      },
      analyzer: {
        scopes: ["analysis", "trading_signal", "resolver_output"],
        markets: ["*"],
        sellsAccessTypes: ["analysis", "trading_signal", "resolver_output"],
        reputationEligible: true,
        llmReceiptRequired: true,
      },
      evaluator: {
        scopes: ["evaluation", "risk_check", "pre_trade_validation"],
        markets: ["*"],
        sellsAccessTypes: ["evaluation", "risk_check", "pre_trade_validation"],
        reputationEligible: true,
        llmReceiptRequired: true,
      },
      executor: {
        scopes: ["hft_session", "execution_receipt", "external_trace"],
        markets: ["*"],
        sellsAccessTypes: ["execution_signal", "execution_receipt"],
        reputationEligible: true,
        llmReceiptRequired: true,
      },
      prediction_market_trader: {
        scopes: ["hft_session", "trading_signal", "execution_receipt"],
        markets: ["*"],
        sellsAccessTypes: [
          "trading_signal",
          "execution_signal",
          "execution_receipt",
        ],
        reputationEligible: true,
        llmReceiptRequired: true,
      },
    },
  },
} as const;

export type AgentCommerceNormalizedGateContext = {
  category: string;
  buyerAgentId: string;
  buyerRole: string;
  sellerAgentId: string;
  sellerRole: string;
  serviceAgentId: string;
  serviceRole: string;
  scope: string;
  market: string;
  sessionId: string;
  runtimeId: string | null;
  sourcePayloadHash: string | null;
  payloadHash: string;
  accessType: string;
  gateKey: string | null;
  resource: string;
};

export type AgentCommerceGateContext = AgentCommerceNormalizedGateContext & {
  amountAtomic: string;
  reputationEligible: boolean;
  llmReceiptRequired: boolean;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidHash(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isAllowedMarket(
  allowed: string[] | undefined,
  market: string,
): boolean {
  if (!allowed || allowed.includes("*")) return true;
  return allowed.includes(market);
}

function hasLlmSummary(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const summary = (value as Record<string, unknown>).summary;
  return typeof summary === "string" && summary.trim().length > 0;
}

export function getAgentCommercePolicy(category: string) {
  return AGENT_COMMERCE_POLICIES[category] ?? null;
}

export function normalizeAgentCommerceGateRequest(
  input: Record<string, unknown>,
):
  | { ok: true; ctx: AgentCommerceNormalizedGateContext }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      details?: Record<string, unknown>;
    } {
  const category = normalizeGateSlug(cleanString(input.category));
  const buyerAgentId = cleanString(input.buyerAgentId);
  const buyerRole = normalizeGateSlug(cleanString(input.buyerRole));
  const sellerAgentId = cleanString(input.serviceAgentId) || cleanString(input.sellerAgentId);
  const sellerRole = normalizeGateSlug(cleanString(input.serviceRole) || cleanString(input.sellerRole));
  const scope = normalizeGateSlug(cleanString(input.scope));
  const market = normalizeGateSlug(
    cleanString(input.marketId) || cleanString(input.market) || "default",
  );
  const sessionId = cleanString(input.sessionId);
  const runtimeId = cleanString(input.runtimeId) || null;
  const accessType = normalizeGateSlug(cleanString(input.accessType));
  const rawGateKey = cleanString(input.gateKey);
  const gateKey = rawGateKey ? normalizeGateSlug(rawGateKey) : null;
  const allowSelfPurchase = input.allowSelfPurchase === true;

  if (!category)
    return {
      ok: false,
      status: 400,
      error: "missing_category",
      message: "category is required",
    };
  if (!buyerAgentId)
    return {
      ok: false,
      status: 400,
      error: "missing_buyer_agent_id",
      message: "buyerAgentId is required",
    };
  if (!buyerRole)
    return {
      ok: false,
      status: 400,
      error: "missing_buyer_role",
      message: "buyerRole is required",
    };
  if (!sellerAgentId)
    return {
      ok: false,
      status: 400,
      error: "missing_seller_agent_id",
      message: "serviceAgentId or sellerAgentId is required",
    };
  if (!sellerRole)
    return {
      ok: false,
      status: 400,
      error: "missing_seller_role",
      message: "serviceRole or sellerRole is required",
    };
  if (!scope)
    return {
      ok: false,
      status: 400,
      error: "missing_scope",
      message: "scope is required",
    };
  if (!sessionId)
    return {
      ok: false,
      status: 400,
      error: "missing_session_id",
      message: "sessionId is required",
    };
  if (!accessType)
    return {
      ok: false,
      status: 400,
      error: "missing_access_type",
      message: "accessType is required",
    };

  if (buyerRole.length > 64) {
    return {
      ok: false,
      status: 400,
      error: "buyer_role_too_long",
      message: "buyerRole must be 64 characters or fewer.",
    };
  }
  if (sellerRole.length > 64) {
    return {
      ok: false,
      status: 400,
      error: "seller_role_too_long",
      message: "sellerRole must be 64 characters or fewer.",
    };
  }
  if (gateKey && gateKey.length > 96) {
    return {
      ok: false,
      status: 400,
      error: "gate_key_too_long",
      message: "gateKey must be 96 characters or fewer.",
    };
  }

  if (!allowSelfPurchase && buyerAgentId === sellerAgentId) {
    return {
      ok: false,
      status: 403,
      error: "self_purchase_not_allowed",
      message: "buyerAgentId and sellerAgentId must be different.",
    };
  }

  if (typeof input.sellerPayTo === "string" && input.sellerPayTo.trim()) {
    return {
      ok: false,
      status: 400,
      error: "seller_pay_to_not_allowed",
      message:
        "sellerPayTo must not be supplied by buyer request. It is resolved from seller commerce profile or service gate.",
    };
  }

  const rawSourcePayloadHash = cleanString(input.payloadHash);
  const sourcePayloadHash = isValidHash(rawSourcePayloadHash)
    ? rawSourcePayloadHash
    : null;

  const payloadBase: Record<string, unknown> = {
    purpose: "x402_circle_commerce",
    category,
    buyerAgentId,
    buyerRole,
    sellerAgentId,
    sellerRole,
    scope,
    market,
    sessionId,
    runtimeId,
    accessType,
    sourcePayloadHash,
    payload: input.payload ?? {},
    llmReceipt: input.llmReceipt ?? null,
  };
  if (gateKey) payloadBase.gateKey = gateKey;

  const payloadHash = stablePayloadHash(payloadBase);

  const resource = [
    "/api/x402/agent-commerce-gate",
    category,
    market,
    sellerAgentId,
    sellerRole,
    accessType,
    gateKey ?? "default",
    sessionId,
  ].join("/");

  return {
    ok: true,
    ctx: {
      category,
      buyerAgentId,
      buyerRole,
      sellerAgentId,
      sellerRole,
      serviceAgentId: sellerAgentId,
      serviceRole: sellerRole,
      scope,
      market,
      sessionId,
      runtimeId,
      sourcePayloadHash,
      payloadHash,
      accessType,
      gateKey,
      resource,
    },
  };
}

export function validateAgentCommerceFallbackPolicy(
  ctx: AgentCommerceNormalizedGateContext,
  input: Record<string, unknown>,
):
  | {
      ok: true;
      amountAtomic: string;
      reputationEligible: boolean;
      llmReceiptRequired: boolean;
    }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      details?: Record<string, unknown>;
    } {
  const categoryPolicy = AGENT_COMMERCE_POLICIES[ctx.category];
  if (!categoryPolicy) {
    return {
      ok: false,
      status: 403,
      error: "category_not_allowed",
      message: `Commerce category ${ctx.category} is not allowed.`,
      details: { category: ctx.category },
    };
  }

  const buyerPolicy = categoryPolicy.roles[ctx.buyerRole];
  if (!buyerPolicy) {
    return {
      ok: false,
      status: 403,
      error: "buyer_role_not_allowed",
      message: `Buyer role ${ctx.buyerRole} is not allowed for ${ctx.category}.`,
      details: {
        category: ctx.category,
        buyerRole: ctx.buyerRole,
        allowedRoles: Object.keys(categoryPolicy.roles),
      },
    };
  }

  const sellerPolicy = categoryPolicy.roles[ctx.sellerRole];
  if (!sellerPolicy) {
    return {
      ok: false,
      status: 403,
      error: "seller_role_not_allowed",
      message: `Seller role ${ctx.sellerRole} is not allowed for ${ctx.category}.`,
      details: {
        category: ctx.category,
        sellerRole: ctx.sellerRole,
        allowedRoles: Object.keys(categoryPolicy.roles),
      },
    };
  }

  if (!sellerPolicy.scopes.includes(ctx.scope)) {
    return {
      ok: false,
      status: 403,
      error: "scope_not_allowed",
      message: `Scope ${ctx.scope} is not allowed for seller ${ctx.category}/${ctx.sellerRole}.`,
      details: {
        category: ctx.category,
        sellerRole: ctx.sellerRole,
        scope: ctx.scope,
        allowedScopes: sellerPolicy.scopes,
      },
    };
  }

  if (!isAllowedMarket(sellerPolicy.markets, ctx.market)) {
    return {
      ok: false,
      status: 403,
      error: "market_not_allowed",
      message: `Market ${ctx.market} is not allowed for seller ${ctx.category}/${ctx.sellerRole}.`,
      details: {
        category: ctx.category,
        sellerRole: ctx.sellerRole,
        market: ctx.market,
        allowedMarkets: sellerPolicy.markets ?? ["*"],
      },
    };
  }

  if (!sellerPolicy.sellsAccessTypes.includes(ctx.accessType)) {
    return {
      ok: false,
      status: 403,
      error: "access_type_not_allowed",
      message: `Access type ${ctx.accessType} is not sold by ${ctx.category}/${ctx.sellerRole}.`,
      details: {
        category: ctx.category,
        sellerRole: ctx.sellerRole,
        accessType: ctx.accessType,
        allowedAccessTypes: sellerPolicy.sellsAccessTypes,
      },
    };
  }

  if (sellerPolicy.llmReceiptRequired && !hasLlmSummary(input.llmReceipt)) {
    return {
      ok: false,
      status: 400,
      error: "llm_receipt_required",
      message: `${ctx.category}/${ctx.sellerRole}/${ctx.accessType} requires llmReceipt.summary.`,
    };
  }

  return {
    ok: true,
    amountAtomic:
      sellerPolicy.amountAtomic ?? categoryPolicy.defaultAmountAtomic,
    reputationEligible: sellerPolicy.reputationEligible ?? false,
    llmReceiptRequired: sellerPolicy.llmReceiptRequired ?? false,
  };
}

export function resolveAgentCommerceGate(
  input: Record<string, unknown>,
):
  | { ok: true; ctx: AgentCommerceGateContext }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      details?: Record<string, unknown>;
    } {
  const normalized = normalizeAgentCommerceGateRequest(input);
  if (!normalized.ok) return normalized;

  const fallback = validateAgentCommerceFallbackPolicy(normalized.ctx, input);
  if (!fallback.ok) return fallback;

  return {
    ok: true,
    ctx: {
      ...normalized.ctx,
      amountAtomic: fallback.amountAtomic,
      reputationEligible: fallback.reputationEligible,
      llmReceiptRequired: fallback.llmReceiptRequired,
    },
  };
}
