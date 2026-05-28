import { stablePayloadHash } from '@/lib/agent-bridge/store';
import { normalizeGateSlug } from '@/lib/x402/circle-agent-policy';

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

export const AGENT_COMMERCE_POLICIES: Record<string, AgentCommerceCategoryPolicy> = {
  'prediction-market-bots': {
    label: 'Prediction Market Commerce',
    defaultAmountAtomic: '1',
    roles: {
      oracle: {
        scopes: ['market_data', 'feed_snapshot', 'candles', 'orderbook'],
        markets: ['*'],
        sellsAccessTypes: ['oracle_data', 'market_data', 'candles', 'orderbook'],
        reputationEligible: true,
        llmReceiptRequired: false,
      },
      analyzer: {
        scopes: ['analysis', 'trading_signal', 'resolver_output'],
        markets: ['*'],
        sellsAccessTypes: ['analysis', 'trading_signal', 'resolver_output'],
        reputationEligible: true,
        llmReceiptRequired: true,
      },
      evaluator: {
        scopes: ['evaluation', 'risk_check', 'pre_trade_validation'],
        markets: ['*'],
        sellsAccessTypes: ['evaluation', 'risk_check', 'pre_trade_validation'],
        reputationEligible: true,
        llmReceiptRequired: true,
      },
      executor: {
        scopes: ['hft_session', 'execution_receipt', 'external_trace'],
        markets: ['*'],
        sellsAccessTypes: ['execution_signal', 'execution_receipt'],
        reputationEligible: true,
        llmReceiptRequired: true,
      },
      prediction_market_trader: {
        scopes: ['hft_session', 'trading_signal', 'execution_receipt'],
        markets: ['*'],
        sellsAccessTypes: ['trading_signal', 'execution_signal', 'execution_receipt'],
        reputationEligible: true,
        llmReceiptRequired: true,
      },
    },
  },
} as const;

export type AgentCommerceGateContext = {
  category: string;
  buyerAgentId: string;
  buyerRole: string;
  sellerAgentId: string;
  sellerRole: string;
  scope: string;
  market: string;
  sessionId: string;
  runtimeId: string | null;
  payloadHash: string;
  accessType: string;
  amountAtomic: string;
  reputationEligible: boolean;
  llmReceiptRequired: boolean;
  resource: string;
};

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidHash(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isAllowedMarket(allowed: string[] | undefined, market: string): boolean {
  if (!allowed || allowed.includes('*')) return true;
  return allowed.includes(market);
}

function hasLlmSummary(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const summary = (value as Record<string, unknown>).summary;
  return typeof summary === 'string' && summary.trim().length > 0;
}

export function getAgentCommercePolicy(category: string) {
  return AGENT_COMMERCE_POLICIES[category] ?? null;
}

export function resolveAgentCommerceGate(input: Record<string, unknown>):
  | { ok: true; ctx: AgentCommerceGateContext }
  | { ok: false; status: number; error: string; message: string; details?: Record<string, unknown> } {
  const category = normalizeGateSlug(cleanString(input.category));
  const buyerAgentId = cleanString(input.buyerAgentId);
  const buyerRole = normalizeGateSlug(cleanString(input.buyerRole));
  const sellerAgentId = cleanString(input.sellerAgentId);
  const sellerRole = normalizeGateSlug(cleanString(input.sellerRole));
  const scope = normalizeGateSlug(cleanString(input.scope));
  const market = normalizeGateSlug(cleanString(input.marketId) || cleanString(input.market) || 'default');
  const sessionId = cleanString(input.sessionId);
  const runtimeId = cleanString(input.runtimeId) || null;
  const accessType = normalizeGateSlug(cleanString(input.accessType));
  const allowSelfPurchase = input.allowSelfPurchase === true;

  if (!category) return { ok: false, status: 400, error: 'missing_category', message: 'category is required' };
  if (!buyerAgentId) return { ok: false, status: 400, error: 'missing_buyer_agent_id', message: 'buyerAgentId is required' };
  if (!buyerRole) return { ok: false, status: 400, error: 'missing_buyer_role', message: 'buyerRole is required' };
  if (!sellerAgentId) return { ok: false, status: 400, error: 'missing_seller_agent_id', message: 'sellerAgentId is required' };
  if (!sellerRole) return { ok: false, status: 400, error: 'missing_seller_role', message: 'sellerRole is required' };
  if (!scope) return { ok: false, status: 400, error: 'missing_scope', message: 'scope is required' };
  if (!sessionId) return { ok: false, status: 400, error: 'missing_session_id', message: 'sessionId is required' };
  if (!accessType) return { ok: false, status: 400, error: 'missing_access_type', message: 'accessType is required' };

  if (category !== 'prediction-market-bots') {
    return {
      ok: false,
      status: 403,
      error: 'category_not_allowed',
      message: 'Only prediction-market-bots is allowed in this PR.',
      details: { category },
    };
  }

  if (!allowSelfPurchase && buyerAgentId === sellerAgentId) {
    return {
      ok: false,
      status: 403,
      error: 'self_purchase_not_allowed',
      message: 'buyerAgentId and sellerAgentId must be different.',
    };
  }

  const categoryPolicy = AGENT_COMMERCE_POLICIES[category];
  if (!categoryPolicy) {
    return {
      ok: false,
      status: 403,
      error: 'category_not_allowed',
      message: `Commerce category ${category} is not allowed.`,
      details: { category },
    };
  }

  const buyerPolicy = categoryPolicy.roles[buyerRole];
  if (!buyerPolicy) {
    return {
      ok: false,
      status: 403,
      error: 'buyer_role_not_allowed',
      message: `Buyer role ${buyerRole} is not allowed for ${category}.`,
      details: { category, buyerRole, allowedRoles: Object.keys(categoryPolicy.roles) },
    };
  }

  const sellerPolicy = categoryPolicy.roles[sellerRole];
  if (!sellerPolicy) {
    return {
      ok: false,
      status: 403,
      error: 'seller_role_not_allowed',
      message: `Seller role ${sellerRole} is not allowed for ${category}.`,
      details: { category, sellerRole, allowedRoles: Object.keys(categoryPolicy.roles) },
    };
  }

  if (!sellerPolicy.scopes.includes(scope)) {
    return {
      ok: false,
      status: 403,
      error: 'scope_not_allowed',
      message: `Scope ${scope} is not allowed for seller ${category}/${sellerRole}.`,
      details: { category, sellerRole, scope, allowedScopes: sellerPolicy.scopes },
    };
  }

  if (!isAllowedMarket(sellerPolicy.markets, market)) {
    return {
      ok: false,
      status: 403,
      error: 'market_not_allowed',
      message: `Market ${market} is not allowed for seller ${category}/${sellerRole}.`,
      details: { category, sellerRole, market, allowedMarkets: sellerPolicy.markets ?? ['*'] },
    };
  }

  if (!sellerPolicy.sellsAccessTypes.includes(accessType)) {
    return {
      ok: false,
      status: 403,
      error: 'access_type_not_allowed',
      message: `Access type ${accessType} is not sold by ${category}/${sellerRole}.`,
      details: { category, sellerRole, accessType, allowedAccessTypes: sellerPolicy.sellsAccessTypes },
    };
  }

  if (sellerPolicy.llmReceiptRequired && !hasLlmSummary(input.llmReceipt)) {
    return {
      ok: false,
      status: 400,
      error: 'llm_receipt_required',
      message: `${category}/${sellerRole}/${accessType} requires llmReceipt.summary.`,
    };
  }

  if (typeof input.sellerPayTo === 'string' && input.sellerPayTo.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'seller_pay_to_not_allowed',
      message: 'sellerPayTo must not be supplied by buyer request. It is resolved from seller commerce profile.',
    };
  }

  const rawPayloadHash = cleanString(input.payloadHash);
  const payloadHash = isValidHash(rawPayloadHash)
    ? rawPayloadHash
    : stablePayloadHash({
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
        payload: input.payload ?? {},
        llmReceipt: input.llmReceipt ?? null,
      });

  const amountAtomic = sellerPolicy.amountAtomic ?? categoryPolicy.defaultAmountAtomic;

  const resource = [
    '/api/x402/agent-commerce-gate',
    category,
    market,
    sellerAgentId,
    sellerRole,
    accessType,
    sessionId,
  ].join('/');

  return {
    ok: true,
    ctx: {
      category,
      buyerAgentId,
      buyerRole,
      sellerAgentId,
      sellerRole,
      scope,
      market,
      sessionId,
      runtimeId,
      payloadHash,
      accessType,
      amountAtomic,
      reputationEligible: sellerPolicy.reputationEligible ?? false,
      llmReceiptRequired: sellerPolicy.llmReceiptRequired ?? false,
      resource,
    },
  };
}
