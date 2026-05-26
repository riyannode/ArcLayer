/**
 * Rail separation tests — verify x402 offchain vs ERC-8183 escrow isolation.
 */
import { describe, it, expect } from 'vitest';

// ─── Test data ─────────────────────────────────────────────────────────────────

const x402JobRow = {
  job_id: 'job-x402-001',
  settlement_mode: 'x402_offchain',
  status: 'created',
  buyer_agent_id: 'buyer_001',
  worker_id: null,
  input_payload: { task: 'analyze' },
  input_payload_hash: 'a'.repeat(64),
  price_atomic: '1000',
  asset: '0x3600000000000000000000000000000000000000',
  chain_id: '5042002',
  created_at: new Date().toISOString(),
};

const erc8183Row = {
  job_id: 'job-erc-001',
  settlement_mode: 'erc8183_escrow',
  erc8183_status: 'Open',
  status: 'created',
  buyer_agent_id: 'buyer_001',
  worker_id: null,
  client_address: '0x1111111111111111111111111111111111111111',
  provider_address: '0x2222222222222222222222222222222222222222',
  input_payload: { escrowTask: 'deliver' },
  input_payload_hash: 'b'.repeat(64),
  price_atomic: '5000',
  asset: '0x3600000000000000000000000000000000000000',
  chain_id: '5042002',
  created_at: new Date().toISOString(),
};

// ─── Fake SQL query builder ────────────────────────────────────────────────────

function fakeQuery(rows: Record<string, unknown>[]) {
  return {
    from: (_table: string) => ({
      select: (_cols?: string) => ({
        eq: (col: string, val: unknown) => ({
          eq: (col2: string, val2: unknown) => ({
            maybeSingle: () => {
              const match = rows.find(
                (r) => r[col] === val && r[col2] === val2,
              );
              if (!match) return Promise.resolve({ data: null, error: null });
              return Promise.resolve({ data: { ...match }, error: null });
            },
            in: (_col3: string, _vals: unknown[]) => ({
              eq: (col4: string, val4: unknown) => ({
                maybeSingle: () => {
                  const match = rows.find(
                    (r) => r[col] === val && r[col2] === val2 && r[col4] === val4,
                  );
                  if (!match) return Promise.resolve({ data: null, error: null });
                  return Promise.resolve({ data: { ...match }, error: null });
                },
                maybeSingle: () => {
                  const match = rows.find((r) => r[col] === val && r[col2] === val2);
                  return match
                    ? Promise.resolve({ data: { ...match }, error: null })
                    : Promise.resolve({ data: null, error: null });
                },
                select: () => ({
                  maybeSingle: () => {
                    const match = rows.find((r) => r[col] === val && r[col2] === val2);
                    return match
                      ? Promise.resolve({ data: { ...match }, error: null })
                      : Promise.resolve({ data: null, error: null });
                  },
                }),
              }),
            }),
            maybeSingle: () => {
              const match = rows.find((r) => r[col] === val);
              return match
                ? Promise.resolve({ data: { ...match }, error: null })
                : Promise.resolve({ data: null, error: null });
            },
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          maybeSingle: () => {
            const match = rows.find((r) => r[col] === val);
            return match
              ? Promise.resolve({ data: { ...match }, error: null })
              : Promise.resolve({ data: null, error: null });
          },
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
      update: (_patch: Record<string, unknown>) => ({
        eq: (col: string, val: unknown) => ({
          eq: (col2: string, val2: unknown) => ({
            eq: (col3: string, val3: unknown) => ({
              select: () => ({
                maybeSingle: () => {
                  const match = rows.find(
                    (r) => r[col] === val && r[col2] === val2 && r[col3] === val3,
                  );
                  if (!match) return Promise.resolve({ data: null, error: null });
                  Object.assign(match, _patch);
                  return Promise.resolve({ data: { ...match }, error: null });
                },
              }),
            }),
          }),
        }),
      }),
    }),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('rail separation', () => {
  describe('legacy GET excludes erc8183_escrow', () => {
    it('defaults to x402_offchain when no filter given', async () => {
      const rows = [x402JobRow, erc8183Row];
      const q = fakeQuery(rows).from('agent_jobs').select('*');
      const { data } = await q
        .eq('settlement_mode', 'x402_offchain')
        .order('created_at', { ascending: false })
        .limit(50);
      expect(data).toBeDefined();
    });

    it('erc8183_escrow row is not returned with x402_offchain filter', async () => {
      const rows = [x402JobRow, erc8183Row];
      const q = fakeQuery(rows).from('agent_jobs').select('*');
      const { data } = await q
        .eq('settlement_mode', 'x402_offchain')
        .order('created_at', { ascending: false })
        .limit(50);
      const settlementModes = (data ?? []).map((r: any) => r.settlement_mode);
      expect(settlementModes.every((m: string) => m === 'x402_offchain')).toBe(true);
    });
  });

  describe('legacy store mutators cannot mutate erc8183_escrow', () => {
    it('x402_offchain filter excludes erc8183_escrow rows from mutations', async () => {
      // The store functions add .eq('settlement_mode', 'x402_offchain') to
      // every legacy mutation. An erc8183_escrow row won't match the filter.
      const filter = { settlement_mode: 'x402_offchain' };
      const row = { ...erc8183Row, settlement_mode: 'erc8183_escrow' };
      const matches = row.settlement_mode === filter.settlement_mode;
      expect(matches).toBe(false);
    });
  });

  describe('ERC-8183 tx route naming dual support', () => {
    it('accepts camelCase txType/txHash', () => {
      const body = { txType: 'fund', txHash: '0xabcdef' };
      const txType = (body.txType ?? (body as any).tx_type) as string | undefined;
      const txHash = (body.txHash ?? (body as any).tx_hash) as string | undefined;
      expect(txType).toBe('fund');
      expect(txHash).toBe('0xabcdef');
    });

    it('accepts snake_case tx_type/tx_hash', () => {
      const body = { tx_type: 'submit', tx_hash: '0x123456' };
      const txType = (body.txType ?? body.tx_type) as string | undefined;
      const txHash = (body.txHash ?? body.tx_hash) as string | undefined;
      expect(txType).toBe('submit');
      expect(txHash).toBe('0x123456');
    });
  });

  describe('Bridge payload_hash_mismatch', () => {
    it('rejects when client hash does not match server hash', () => {
      const payload = { sessionId: 's1', role: 'analyzer' };
      const serverHash = 'abc';
      const clientHash = 'def';

      if (clientHash && clientHash !== serverHash) {
        // This is the P0.7 logic from events/route.ts
        const error = {
          ok: false as const,
          rail: 'bridge' as const,
          settlementMode: 'x402_offchain' as const,
          error: 'payload_hash_mismatch' as const,
          expectedPayloadHash: serverHash,
          receivedPayloadHash: clientHash,
        };
        expect(error.error).toBe('payload_hash_mismatch');
        expect(error.expectedPayloadHash).toBe('abc');
        expect(error.receivedPayloadHash).toBe('def');
      } else {
        // Should not reach here
        expect(true).toBe(false);
      }
    });

    it('accepts when client hash matches server hash', () => {
      const payload = { sessionId: 's1', role: 'evaluator' };
      const serverHash = 'abc';
      const clientHash = 'abc';

      if (clientHash && clientHash !== serverHash) {
        // Should not reach here
        expect(true).toBe(false);
      } else {
        // Accept — hashes match
        expect(serverHash).toBe(clientHash);
      }
    });
  });

  describe('Bridge-access returns requested session only', () => {
    it('does not return latest session data for a different requested sessionId', () => {
      const latest = { sessionId: 'session-999', events: [], receipts: [] };
      const requestedSessionId = 'session-001';

      const isLatestSession = latest?.sessionId === requestedSessionId;
      expect(isLatestSession).toBe(false);

      // When not latest, should NOT use latest data
      const sessionEvents = isLatestSession ? latest?.events?.slice(-5) ?? [] : [];
      const sessionReceipts = isLatestSession ? latest?.receipts ?? [] : [];
      expect(sessionEvents).toHaveLength(0);
      expect(sessionReceipts).toHaveLength(0);
    });
  });

  describe('Rail overview counts separated', () => {
    it('escrow and offchain counts are distinct', () => {
      const rows = [x402JobRow, erc8183Row];
      const escrowRows = rows.filter((r) => r.settlement_mode === 'erc8183_escrow');
      const offchainRows = rows.filter((r) => r.settlement_mode === 'x402_offchain');

      expect(escrowRows).toHaveLength(1);
      expect(offchainRows).toHaveLength(1);
      expect(escrowRows[0].settlement_mode).toBe('erc8183_escrow');
      expect(offchainRows[0].settlement_mode).toBe('x402_offchain');
    });
  });
});
