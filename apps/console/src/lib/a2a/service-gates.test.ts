import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { A2AAgentServiceGate } from './service-gates';

const rows: A2AAgentServiceGate[] = [];

function makeGate(overrides: Partial<A2AAgentServiceGate>): A2AAgentServiceGate {
  return {
    id: overrides.id ?? `${overrides.service_agent_id}-${overrides.gate_key}-${overrides.market}`,
    service_agent_id: overrides.service_agent_id ?? 'oracle-a',
    gate_key: overrides.gate_key ?? 'default',
    category: overrides.category ?? 'prediction-market-bots',
    service_role: overrides.service_role ?? 'oracle',
    scope: overrides.scope ?? 'market_data',
    access_type: overrides.access_type ?? 'oracle_data',
    market: overrides.market ?? '*',
    price_atomic: overrides.price_atomic ?? '1',
    currency: overrides.currency ?? 'USDC',
    rail: overrides.rail ?? 'circle-gateway',
    pay_to: overrides.pay_to ?? null,
    reputation_eligible: overrides.reputation_eligible ?? true,
    llm_receipt_required: overrides.llm_receipt_required ?? false,
    is_active: overrides.is_active ?? true,
    metadata: overrides.metadata ?? {},
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00.000Z',
  };
}

type Filter = { column: keyof A2AAgentServiceGate; value: unknown };

class QueryBuilder {
  private filters: Filter[] = [];
  private selected = false;
  private upsertRow: Partial<A2AAgentServiceGate> | null = null;

  select() {
    this.selected = true;
    return this;
  }

  eq(column: keyof A2AAgentServiceGate, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  order() {
    return Promise.resolve({ data: this.filtered(), error: null });
  }

  upsert(row: Partial<A2AAgentServiceGate>) {
    this.upsertRow = row;
    return this;
  }

  single() {
    if (!this.upsertRow || !this.selected) return Promise.resolve({ data: null, error: new Error('bad query') });
    const row = makeGate({
      ...this.upsertRow,
      id: 'gate-upserted',
      created_at: '2026-01-01T00:00:00.000Z',
    } as Partial<A2AAgentServiceGate>);
    rows.push(row);
    return Promise.resolve({ data: row, error: null });
  }

  private filtered() {
    return rows.filter((row) => this.filters.every((filter) => row[filter.column] === filter.value));
  }
}

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => ({
    from: () => new QueryBuilder(),
  }),
}));

import {
  assertPositiveAtomic,
  getActiveServiceGate,
  normalizeOptionalAddress,
  upsertServiceGate,
} from './service-gates';

describe('A2A service gate resolver', () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it('uses exact market before wildcard', async () => {
    rows.push(makeGate({ market: '*', price_atomic: '2000' }));
    rows.push(makeGate({ market: 'polymarket', price_atomic: '10000' }));

    const gate = await getActiveServiceGate({
      serviceAgentId: 'oracle-a',
      category: 'prediction-market-bots',
      serviceRole: 'oracle',
      scope: 'market_data',
      accessType: 'oracle_data',
      market: 'polymarket',
      rail: 'circle-gateway',
    });

    expect(gate?.price_atomic).toBe('10000');
  });

  it('falls back to wildcard market when exact market is missing', async () => {
    rows.push(makeGate({ market: '*', price_atomic: '2000' }));

    const gate = await getActiveServiceGate({
      serviceAgentId: 'oracle-a',
      category: 'prediction-market-bots',
      serviceRole: 'oracle',
      scope: 'market_data',
      accessType: 'oracle_data',
      market: 'kalshi',
      rail: 'circle-gateway',
    });

    expect(gate?.price_atomic).toBe('2000');
  });

  it('allows same service_role for different service_agent_id with different prices', async () => {
    rows.push(makeGate({ service_agent_id: 'oracle-a', price_atomic: '2000' }));
    rows.push(makeGate({ service_agent_id: 'oracle-b', price_atomic: '10000' }));

    const gateA = await getActiveServiceGate({
      serviceAgentId: 'oracle-a',
      category: 'prediction-market-bots',
      serviceRole: 'oracle',
      scope: 'market_data',
      accessType: 'oracle_data',
      market: 'default',
    });
    const gateB = await getActiveServiceGate({
      serviceAgentId: 'oracle-b',
      category: 'prediction-market-bots',
      serviceRole: 'oracle',
      scope: 'market_data',
      accessType: 'oracle_data',
      market: 'default',
    });

    expect(gateA?.price_atomic).toBe('2000');
    expect(gateB?.price_atomic).toBe('10000');
  });

  it('allows the same service_agent_id to expose two gate_key prices', async () => {
    rows.push(makeGate({ gate_key: 'basic', price_atomic: '2000' }));
    rows.push(makeGate({ gate_key: 'premium', price_atomic: '10000' }));

    const gate = await getActiveServiceGate({
      serviceAgentId: 'oracle-a',
      gateKey: 'premium',
      category: 'prediction-market-bots',
      serviceRole: 'oracle',
      scope: 'market_data',
      accessType: 'oracle_data',
      market: 'default',
    });

    expect(gate?.price_atomic).toBe('10000');
  });

  it('throws service_gate_ambiguous when gateKey is missing and multiple gates match', async () => {
    rows.push(makeGate({ gate_key: 'basic', price_atomic: '2000' }));
    rows.push(makeGate({ gate_key: 'premium', price_atomic: '10000' }));

    await expect(getActiveServiceGate({
      serviceAgentId: 'oracle-a',
      category: 'prediction-market-bots',
      serviceRole: 'oracle',
      scope: 'market_data',
      accessType: 'oracle_data',
      market: 'default',
    })).rejects.toMatchObject({ code: 'service_gate_ambiguous', status: 409 });
  });

  it.each(['0', '-1', '1.5', '', 'abc'])('rejects invalid priceAtomic=%s', (value) => {
    expect(() => assertPositiveAtomic(value)).toThrow('priceAtomic must be a positive integer string');
  });

  it('validates pay_to when supplied', async () => {
    expect(normalizeOptionalAddress(undefined)).toBeNull();
    expect(normalizeOptionalAddress('0x0000000000000000000000000000000000000001')).toBe('0x0000000000000000000000000000000000000001');
    expect(() => normalizeOptionalAddress('not-an-address')).toThrow('payTo must be a valid EVM address');

    const gate = await upsertServiceGate({
      serviceAgentId: 'oracle-a',
      gateKey: 'basic',
      serviceRole: 'oracle',
      scope: 'market_data',
      accessType: 'oracle_data',
      priceAtomic: '2000',
      payTo: '0x0000000000000000000000000000000000000001',
    });
    expect(gate.pay_to).toBe('0x0000000000000000000000000000000000000001');
  });
});
