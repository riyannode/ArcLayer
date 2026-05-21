import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const client = {
    getTransactionReceipt: vi.fn(),
    getTransaction: vi.fn(),
    readContract: vi.fn(),
  };
  return {
    rows,
    client,
    requireApiKey: vi.fn(),
    applyRateLimit: vi.fn(),
    extractJobCompletedFromReceipt: vi.fn(),
    getERC8183Job: vi.fn(),
  };
});

function makeBuilder() {
  const filters: { field: string; value: unknown }[] = [];
  let pendingUpdate: Record<string, unknown> | null = null;

  const builder: any = {
    select() {
      return builder;
    },
    update(payload: Record<string, unknown>) {
      pendingUpdate = payload;
      return builder;
    },
    eq(field: string, value: unknown) {
      filters.push({ field, value });
      return builder;
    },
    maybeSingle() {
      const row = Array.from(mocks.rows.values()).find((item) => filters.every((f) => item[f.field] === f.value));
      return Promise.resolve({ data: row ?? null, error: null });
    },
    single() {
      const row = Array.from(mocks.rows.values()).find((item) => filters.every((f) => item[f.field] === f.value));
      if (!row) return Promise.resolve({ data: null, error: { message: 'not found' } });
      const merged = { ...row, ...(pendingUpdate ?? {}) };
      mocks.rows.set(String(row.id), merged);
      return Promise.resolve({ data: merged, error: null });
    },
  };

  return builder;
}

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => ({
    from: () => makeBuilder(),
  }),
}));

vi.mock('@/lib/a2a/auth', () => ({
  requireApiKey: mocks.requireApiKey,
}));

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: mocks.applyRateLimit,
}));

vi.mock('@/lib/a2a/onchain', () => ({
  ERC8183JobStatus: { Created: 0, BudgetSet: 1, Funded: 2, Submitted: 3, Completed: 4 },
  extractJobCompletedFromReceipt: mocks.extractJobCompletedFromReceipt,
  getERC8183Job: mocks.getERC8183Job,
}));

vi.mock('@arclayer/sdk', () => ({
  ARC_RPC_URLS: ['https://rpc.drpc.testnet.arc.network'],
  arcTestnet: { id: 5042002, name: 'Arc Testnet' },
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(() => mocks.client),
    fallback: vi.fn((transports) => transports[0]),
    http: vi.fn((url) => ({ url })),
  };
});

import { POST } from './route';

const evaluator = '0x1111111111111111111111111111111111111111';
const otherEvaluator = '0x2222222222222222222222222222222222222222';
const completeTx = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/a2a/jobs/job-1/complete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as any;
}

async function post(body: Record<string, unknown>, id = 'job-1') {
  const res = await POST(request(body), { params: { id } });
  return { status: res.status, body: await res.json() };
}

function seedJob(overrides: Record<string, unknown> = {}) {
  mocks.rows.set('job-1', {
    id: 'job-1',
    is_onchain: true,
    onchain_job_id: '42',
    submit_tx: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    settlement_status: 3,
    evaluator,
    proof: { submit: 'proof' },
    ...overrides,
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    complete_tx: completeTx,
    reason: 'approved',
    proof: { complete: 'proof' },
    evaluation: { score: 100 },
    ...overrides,
  };
}

describe('A2A complete route ERC-8183 verification', () => {
  beforeEach(() => {
    mocks.rows.clear();
    vi.clearAllMocks();
    mocks.requireApiKey.mockResolvedValue({ key: { agentId: 'agent-1' } });
    mocks.applyRateLimit.mockReturnValue(null);
    mocks.client.getTransactionReceipt.mockResolvedValue({ status: 'success', logs: [] });
    mocks.client.getTransaction.mockResolvedValue({ from: evaluator });
    mocks.extractJobCompletedFromReceipt.mockReturnValue({ jobId: 42n });
    mocks.getERC8183Job.mockResolvedValue({ id: 42n, evaluator, status: 4 });
  });

  it('rejects non-onchain job', async () => {
    seedJob({ is_onchain: false, onchain_job_id: null });

    const res = await post(validBody());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('job_not_onchain');
    expect(mocks.client.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it('rejects missing complete_tx', async () => {
    seedJob();

    const res = await post(validBody({ complete_tx: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_required_fields');
    expect(res.body.fields).toContain('complete_tx');
  });

  it('rejects receipt success with no JobCompleted event', async () => {
    seedJob();
    mocks.extractJobCompletedFromReceipt.mockImplementation(() => {
      throw new Error('ERC-8183 JobCompleted event not found');
    });

    const res = await post(validBody());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('job_completed_event_not_found');
  });

  it('rejects wrong jobId', async () => {
    seedJob();
    mocks.extractJobCompletedFromReceipt.mockReturnValue({ jobId: 99n });

    const res = await post(validBody());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('job_completed_event_job_id_mismatch');
    expect(res.body.expected).toBe('42');
    expect(res.body.actual).toBe('99');
  });

  it('rejects tx.from not equal evaluator', async () => {
    seedJob();
    mocks.client.getTransaction.mockResolvedValue({ from: otherEvaluator });

    const res = await post(validBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('complete_tx_evaluator_mismatch');
  });

  it('rejects DB evaluator mismatch', async () => {
    seedJob({ evaluator: otherEvaluator });

    const res = await post(validBody());

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('db_evaluator_mismatch');
  });

  it('rejects job not yet submitted', async () => {
    seedJob({ submit_tx: null, settlement_status: 2 });

    const res = await post(validBody());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('job_not_submitted');
    expect(mocks.client.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it('accepts valid complete_tx and updates settlement_status = Completed', async () => {
    seedJob();

    const res = await post(validBody());
    const row = mocks.rows.get('job-1')!;

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(row.complete_tx).toBe(completeTx);
    expect(row.settlement_status).toBe(4);
    expect(row.status).toBe('submitted');
    expect(row.evaluation).toEqual({ score: 100 });
    expect(row.proof).toEqual({ submit: 'proof', complete: 'proof' });
    expect(res.body.receipt).toEqual({
      jobId: 'job-1',
      onchainJobId: '42',
      completeTx,
      settlementStatus: '4',
    });
  });
});
