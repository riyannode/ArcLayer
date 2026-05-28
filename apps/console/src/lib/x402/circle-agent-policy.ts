import { stablePayloadHash } from '@/lib/agent-bridge/store';

export type CircleAgentRolePolicy = {
  scopes: string[];
  markets?: string[];
  amountAtomic?: string;
  reputationEligible?: boolean;
  llmReceiptRequired?: boolean;
};

export type CircleAgentCategoryPolicy = {
  label: string;
  defaultAmountAtomic: string;
  roles: Record<string, CircleAgentRolePolicy>;
};

export const CIRCLE_AGENT_GATE_POLICIES: Record<string, CircleAgentCategoryPolicy> = {
  'prediction-market-bots': {
    label: 'Prediction Market Bots',

    // USDC has 6 decimals for ERC-20 settlement.
    // "1" = 0.000001 USDC.
    // "10000" = 0.01 USDC.
    defaultAmountAtomic: '1',

    roles: {
      oracle: {
        scopes: ['market_data', 'feed_snapshot', 'candles', 'orderbook'],
        markets: ['*'],
        reputationEligible: true,
        llmReceiptRequired: false,
      },

      analyzer: {
        scopes: ['analysis', 'trading_signal', 'resolver_output'],
        markets: ['*'],
        reputationEligible: true,
        llmReceiptRequired: true,
      },

      evaluator: {
        scopes: ['evaluation', 'risk_check', 'pre_trade_validation'],
        markets: ['*'],
        reputationEligible: true,
        llmReceiptRequired: true,
      },

      executor: {
        scopes: ['hft_session', 'execution_receipt', 'external_trace'],
        markets: ['*'],
        reputationEligible: true,
        llmReceiptRequired: true,
      },

      prediction_market_trader: {
        scopes: ['hft_session', 'trading_signal', 'execution_receipt'],
        markets: ['*'],
        reputationEligible: true,
        llmReceiptRequired: true,
      },
    },
  },
} as const;

export type CircleAgentGateContext = {
  category: string;
  role: string;
  scope: string;
  market: string;
  sessionId: string;
  agentId: string;
  runtimeId: string | null;
  payloadHash: string;
  amountAtomic: string;
  reputationEligible: boolean;
  llmReceiptRequired: boolean;
  resource: string;
};

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeGateSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isValidHash(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isAllowedMarket(allowed: string[] | undefined, market: string): boolean {
  if (!allowed || allowed.includes('*')) return true;
  return allowed.includes(market);
}

export function resolveCircleAgentGate(input: Record<string, unknown>):
  | { ok: true; ctx: CircleAgentGateContext }
  | { ok: false; status: number; error: string; message: string; details?: Record<string, unknown> } {
  const category = normalizeGateSlug(cleanString(input.category));
  const role = normalizeGateSlug(cleanString(input.role));
  const scope = normalizeGateSlug(cleanString(input.scope));
  const marketRaw = cleanString(input.marketId) || cleanString(input.market) || 'default';
  const market = normalizeGateSlug(marketRaw);

  const sessionId = cleanString(input.sessionId);
  const agentId = cleanString(input.agentId);
  const runtimeId = cleanString(input.runtimeId) || null;

  if (!category) return { ok: false, status: 400, error: 'missing_category', message: 'category is required' };
  if (!role) return { ok: false, status: 400, error: 'missing_role', message: 'role is required' };
  if (!scope) return { ok: false, status: 400, error: 'missing_scope', message: 'scope is required' };
  if (!sessionId) return { ok: false, status: 400, error: 'missing_session_id', message: 'sessionId is required' };
  if (!agentId) return { ok: false, status: 400, error: 'missing_agent_id', message: 'agentId is required' };

  const categoryPolicy = CIRCLE_AGENT_GATE_POLICIES[category];
  if (!categoryPolicy) {
    console.log('[circle-agent-gate] DENY category_not_allowed category=%s role=%s scope=%s market=%s', category, role, scope, market);
    return {
      ok: false,
      status: 403,
      error: 'category_not_allowed',
      message: `Circle x402 gate does not allow category ${category}`,
      details: { category },
    };
  }

  const rolePolicy = categoryPolicy.roles[role];
  if (!rolePolicy) {
    console.log('[circle-agent-gate] DENY role_not_allowed category=%s role=%s scope=%s market=%s', category, role, scope, market);
    return {
      ok: false,
      status: 403,
      error: 'role_not_allowed',
      message: `Role ${role} is not allowed for category ${category}`,
      details: { category, role, allowedRoles: Object.keys(categoryPolicy.roles) },
    };
  }

  if (!rolePolicy.scopes.includes(scope)) {
    console.log('[circle-agent-gate] DENY scope_not_allowed category=%s role=%s scope=%s market=%s', category, role, scope, market);
    return {
      ok: false,
      status: 403,
      error: 'scope_not_allowed',
      message: `Scope ${scope} is not allowed for ${category}/${role}`,
      details: { category, role, scope, allowedScopes: rolePolicy.scopes },
    };
  }

  if (!isAllowedMarket(rolePolicy.markets, market)) {
    console.log('[circle-agent-gate] DENY market_not_allowed category=%s role=%s scope=%s market=%s', category, role, scope, market);
    return {
      ok: false,
      status: 403,
      error: 'market_not_allowed',
      message: `Market ${market} is not allowed for ${category}/${role}`,
      details: { category, role, market, allowedMarkets: rolePolicy.markets ?? ['*'] },
    };
  }

  const rawPayloadHash = cleanString(input.payloadHash);
  const payloadHash = isValidHash(rawPayloadHash)
    ? rawPayloadHash
    : stablePayloadHash({
        category,
        role,
        scope,
        market,
        sessionId,
        agentId,
        runtimeId,
        payload: input.payload ?? {},
        llmReceipt: input.llmReceipt ?? null,
      });

  const amountAtomic = rolePolicy.amountAtomic ?? categoryPolicy.defaultAmountAtomic;

  const resource = [
    '/api/x402/circle-agent-gate',
    category,
    market,
    role,
    scope,
    sessionId,
  ].join('/');

  console.log('[circle-agent-gate] ALLOW category=%s role=%s scope=%s market=%s amount=%s', category, role, scope, market, amountAtomic);

  return {
    ok: true,
    ctx: {
      category,
      role,
      scope,
      market,
      sessionId,
      agentId,
      runtimeId,
      payloadHash,
      amountAtomic,
      reputationEligible: rolePolicy.reputationEligible ?? false,
      llmReceiptRequired: rolePolicy.llmReceiptRequired ?? false,
      resource,
    },
  };
}
