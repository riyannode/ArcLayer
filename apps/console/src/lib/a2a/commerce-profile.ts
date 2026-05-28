import { getAddress } from 'viem';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { AGENT_COMMERCE_POLICIES } from '@/lib/x402/agent-commerce-policy';

const TABLE = 'a2a_agent_commerce_profiles';

export type AgentCommerceProfile = {
  agent_id: string;
  pay_to: string;
  display_name: string | null;
  category: string;
  role: string;
  default_scope: string;
  default_market: string | null;
  price_atomic: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type UpsertCommerceProfileInput = {
  agentId: string;
  payTo: string;
  displayName?: string | null;
  category: string;
  role: string;
  defaultScope?: string;
  defaultMarket?: string | null;
  priceAtomic?: string;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
};

export function normalizeAddress(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('payTo is required');
  }
  return getAddress(value.trim()) as `0x${string}`;
}

function isPositiveAtomic(value: string): boolean {
  return /^[0-9]+$/.test(value) && BigInt(value) > 0n;
}

function cleanSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function getCommerceProfile(agentId: string): Promise<AgentCommerceProfile | null> {
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .select('agent_id, pay_to, display_name, category, role, default_scope, default_market, price_atomic, is_active, metadata, created_at, updated_at')
    .eq('agent_id', agentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function upsertCommerceProfile(input: UpsertCommerceProfileInput): Promise<AgentCommerceProfile> {
  const agentId = String(input.agentId || '').trim();
  if (!agentId) throw new Error('agentId is required');

  const payTo = normalizeAddress(input.payTo);
  const category = cleanSlug(input.category || 'prediction-market-bots');
  const role = cleanSlug(input.role || '');
  const defaultScope = cleanSlug(input.defaultScope || 'hft_session');
  const defaultMarket = input.defaultMarket ? cleanSlug(input.defaultMarket) : null;
  const priceAtomic = String(input.priceAtomic || '1').trim();

  if (category !== 'prediction-market-bots') {
    throw new Error('Only prediction-market-bots is supported in this PR');
  }

  const categoryPolicy = AGENT_COMMERCE_POLICIES[category];
  if (!categoryPolicy) throw new Error(`Commerce category ${category} is not allowed`);

  const rolePolicy = categoryPolicy.roles[role];
  if (!rolePolicy) throw new Error(`Commerce role ${role} is not allowed for ${category}`);

  if (!rolePolicy.scopes.includes(defaultScope)) {
    throw new Error(`Scope ${defaultScope} is not allowed for ${category}/${role}`);
  }

  if (!isPositiveAtomic(priceAtomic)) {
    throw new Error('priceAtomic must be a positive integer string');
  }

  const row = {
    agent_id: agentId,
    pay_to: payTo,
    display_name: input.displayName ?? null,
    category,
    role,
    default_scope: defaultScope,
    default_market: defaultMarket,
    price_atomic: priceAtomic,
    is_active: input.isActive ?? true,
    metadata: input.metadata ?? {},
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .upsert(row, { onConflict: 'agent_id' })
    .select('agent_id, pay_to, display_name, category, role, default_scope, default_market, price_atomic, is_active, metadata, created_at, updated_at')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function resolveSellerCommerceProfile(input: {
  sellerAgentId: string;
  category: string;
  sellerRole: string;
  market: string;
  scope: string;
}): Promise<AgentCommerceProfile> {
  const profile = await getCommerceProfile(input.sellerAgentId);

  if (!profile) {
    throw Object.assign(new Error('Seller commerce profile was not found'), {
      status: 404,
      code: 'seller_commerce_profile_not_found',
    });
  }

  if (!profile.is_active) {
    throw Object.assign(new Error('Seller commerce profile is inactive'), {
      status: 403,
      code: 'seller_commerce_profile_inactive',
    });
  }

  if (profile.category !== input.category) {
    throw Object.assign(new Error('Seller commerce profile category mismatch'), {
      status: 409,
      code: 'seller_commerce_profile_category_mismatch',
    });
  }

  if (profile.role !== input.sellerRole) {
    throw Object.assign(new Error('Seller commerce profile role mismatch'), {
      status: 409,
      code: 'seller_commerce_profile_role_mismatch',
    });
  }

  if (profile.default_scope !== input.scope) {
    throw Object.assign(new Error('Seller commerce profile scope mismatch'), {
      status: 409,
      code: 'seller_commerce_profile_scope_mismatch',
    });
  }

  if (profile.default_market && profile.default_market !== input.market) {
    throw Object.assign(new Error('Seller commerce profile market mismatch'), {
      status: 409,
      code: 'seller_commerce_profile_market_mismatch',
    });
  }

  normalizeAddress(profile.pay_to);

  if (!isPositiveAtomic(profile.price_atomic)) {
    throw Object.assign(new Error('Seller commerce profile has invalid price'), {
      status: 500,
      code: 'seller_commerce_profile_invalid_price',
    });
  }

  return profile;
}
