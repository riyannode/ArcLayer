import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { A2AAgentServiceGate } from './service-gates';

const rows: A2AAgentServiceGate[] = [];
const calls = {
  insert: 0,
  update: 0,
  upsert: 0,
};
let nextInsertError: { code: string; message: string } | null = null;

function makeGate(overrides: Partial<A2AAgentServiceGate>): A2AAgentServiceGate {
  return {
    id: overrides.id ?? `${overrides.service_agent_id ?? 'oracle-a'}-${overrides.gate_key ?? 'default'}-${overrides.market ?? '*'}`,
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
  private insertRow: Partial<A2AAgentServiceGate> | null = null;
  private updateRow: Partial<A2AAgentServiceGate> | null = null;

  select() {
    return this;
  }

  eq(column: keyof A2AAgentServiceGate, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  order() {
    return Promise.resolve({ data: this.filtered(), error: null });
  }

  maybeSingle() {
    return Promise.resolve({ data: this.filtered()[0] ?? null, error: null });
  }

  insert(row: Partial<A2AAgentServiceGate>) {
    calls.insert += 1;
    this.insertRow = row;
    return this;
  }

  update(row: Partial<A2AAgentServiceGate>) {
    calls.update += 1;
    this.updateRow = row;
    return this;
  }

  upsert() {
    calls.upsert += 1;
    throw new Error('Supabase upsert must not be used for service gates');
  }

  single() {
    if (this.insertRow) return Promise.resolve(this.commitInsert());
    if (this.updateRow) return Promise.resolve(this.commitUpdate());
    return Promise.resolve({ data: this.filtered()[0] ?? null, error: null });
  }

  private commitInsert() {
    if (nextInsertError) {
      const error = nextInsertError;
      nextInsertError = null;
      rows.push(makeGate({
        ...(this.insertRow as Partial<A2AAgentServiceGate>),
        id: 'gate-concurrent',
        price_atomic: '999',
      }));
      return { data: null, error };
    }

    const row = makeGate({
      ...(this.insertRow as Partial<A2AAgentServiceGate>),
      id: 'gate-inserted',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    rows.push(row);
    return { data: row, error: null };
  }

  private commitUpdate() {
    const matches = this.filtered();
    const existing = matches[0];
    if (!existing) return { data: null, error: new Error('row not found') };

    Object.assign(existing, this.updateRow, { updated_at: (this.updateRow?.updated_at as string | undefined) ?? existing.updated_at });
    return { data: existing, error: null };
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
    calls.insert = 0;
    calls.update = 0;
    calls.upsert = 0;
    nextInsertError = null;
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
    expect(calls.upsert).toBe(0);
  });

  it('updates an existing active gate instead of inserting', async () => {
    rows.push(makeGate({ id: 'gate-existing', price_atomic: '1000' }));

    const gate = await upsertServiceGate({
      serviceAgentId: 'oracle-a',
      gateKey: 'default',
      serviceRole: 'oracle',
      scope: 'market_data',
      accessType: 'oracle_data',
      priceAtomic: '3000',
      isActive: false,
    });

    expect(gate.id).toBe('gate-existing');
    expect(gate.price_atomic).toBe('3000');
    expect(gate.is_active).toBe(false);
    expect(rows).toHaveLength(1);
    expect(calls.update).toBe(1);
    expect(calls.insert).toBe(0);
    expect(calls.upsert).toBe(0);
  });

  it('inserts a new gate when no active identity exists', async () => {
    const gate = await upsertServiceGate({
      serviceAgentId: 'oracle-a',
      gateKey: 'default',
      serviceRole: 'oracle',
      scope: 'market_data',
      accessType: 'oracle_data',
      priceAtomic: '3000',
    });

    expect(gate.id).toBe('gate-inserted');
    expect(gate.price_atomic).toBe('3000');
    expect(rows).toHaveLength(1);
    expect(calls.insert).toBe(1);
    expect(calls.update).toBe(0);
    expect(calls.upsert).toBe(0);
  });

  it('handles insert unique violation by re-selecting and updating the active gate', async () => {
    nextInsertError = { code: '23505', message: 'duplicate key value violates unique constraint' };

    const gate = await upsertServiceGate({
      serviceAgentId: 'oracle-a',
      gateKey: 'default',
      serviceRole: 'oracle',
      scope: 'market_data',
      accessType: 'oracle_data',
      priceAtomic: '3000',
    });

    expect(gate.id).toBe('gate-concurrent');
    expect(gate.price_atomic).toBe('3000');
    expect(rows).toHaveLength(1);
    expect(calls.insert).toBe(1);
    expect(calls.update).toBe(1);
    expect(calls.upsert).toBe(0);
  });
});
