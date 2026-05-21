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
    selectError: null as { message: string } | null,
    client,
    submitA2AJob: vi.fn(),
    requireApiKey: vi.fn(),
    applyRateLimit: vi.fn(),
    recordDelivery: vi.fn(),
    extractJobSubmittedFromReceipt: vi.fn(),
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
      if (mocks.selectError) return Promise.resolve({ data: null, error: mocks.selectError });
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

vi.mock('@/lib/a2a/jobs', () => ({
  submitA2AJob: mocks.submitA2AJob,
}));

vi.mock('@/lib/a2a/auth', () => ({
  requireApiKey: mocks.requireApiKey,
}));

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: mocks.applyRateLimit,
}));

vi.mock('@/lib/a2a/reputation', () => ({
  recordDelivery: mocks.recordDelivery,
}));

vi.mock('@/lib/a2a/onchain', () => ({
  ERC8183JobStatus: { Created: 0, BudgetSet: 1, Funded: 2, Submitted: 3, Completed: 4 },
  extractJobSubmittedFromReceipt: mocks.extractJobSubmittedFromReceipt,
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

const provider = '0x1111111111111111111111111111111111111111';
const otherProvider = '0x2222222222222222222222222222222222222222';
const submitTx = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const deliverableHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/a2a/jobs/job-1/submit', {
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
    claimed_by: 'agent-1',
    is_onchain: true,
    onchain_job_id: '42',
    provider,
    ...overrides,
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    output: { result: 'done' },
    proof: { type: 'attestation' },
    deliverable_uri: 'ipfs://deliverable',
    deliverable_hash: deliverableHash,
    proof_uri: 'ipfs://proof',
    submit_tx: submitTx,
    ...overrides,
  };
}

describe('A2A submit route ERC-8183 verification', () => {
  beforeEach(() => {
    mocks.rows.clear();
    mocks.selectError = null;
    vi.clearAllMocks();
    mocks.requireApiKey.mockResolvedValue({ key: { agentId: 'agent-1' } });
    mocks.applyRateLimit.mockReturnValue(null);
    mocks.recordDelivery.mockResolvedValue(undefined);
    mocks.submitA2AJob.mockResolvedValue({ ok: true, job: { id: 'job-1', status: 'submitted' }, receipt: { id: 'receipt_1' } });
    mocks.client.getTransactionReceipt.mockResolvedValue({ status: 'success', logs: [] });
    mocks.client.getTransaction.mockResolvedValue({ from: provider });
    mocks.extractJobSubmittedFromReceipt.mockReturnValue({ jobId: 42n, deliverable: deliverableHash });
    mocks.getERC8183Job.mockResolvedValue({ id: 42n, provider, status: 3 });
  });

  it('returns db_error when Supabase job select fails', async () => {
    mocks.selectError = { message: 'column a2a_jobs.is_onchain does not exist' };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await post({ output: 'done', proof: { ok: true } });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'db_error' });
    expect(errorSpy).toHaveBeenCalledWith('[submit] a2a_jobs fetch error:', mocks.selectError.message);
    expect(mocks.submitA2AJob).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('returns job_not_found only when Supabase row is absent', async () => {
    const res = await post({ output: 'done', proof: { ok: true } });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: 'job_not_found' });
    expect(mocks.submitA2AJob).not.toHaveBeenCalled();
  });

  it('keeps legacy submit flow for non-onchain jobs', async () => {
    seedJob({ is_onchain: false, onchain_job_id: null });

    const res = await post({ output: 'done', proof: { ok: true } });

    expect(res.status).toBe(200);
    expect(mocks.submitA2AJob).toHaveBeenCalledWith('job-1', {
      agentId: 'agent-1',
      output: 'done',
      proof: { ok: true },
      summary: undefined,
    });
    expect(mocks.client.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it('rejects onchain job missing submit_tx', async () => {
    seedJob();

    const res = await post(validBody({ submit_tx: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_required_fields');
    expect(res.body.fields).toContain('submit_tx');
  });

  it('rejects success receipt with no JobSubmitted event', async () => {
    seedJob();
    mocks.extractJobSubmittedFromReceipt.mockImplementation(() => {
      throw new Error('ERC-8183 JobSubmitted event not found');
    });

    const res = await post(validBody());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('job_submitted_event_not_found');
  });

  it('rejects wrong jobId event', async () => {
    seedJob();
    mocks.extractJobSubmittedFromReceipt.mockReturnValue({ jobId: 99n, deliverable: deliverableHash });

    const res = await post(validBody());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('job_submitted_event_job_id_mismatch');
    expect(res.body.expected).toBe('42');
    expect(res.body.actual).toBe('99');
  });

  it('rejects wrong deliverable_hash', async () => {
    seedJob();
    mocks.extractJobSubmittedFromReceipt.mockReturnValue({
      jobId: 42n,
      deliverable: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    });

    const res = await post(validBody());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('job_submitted_event_deliverable_mismatch');
  });

  it('rejects tx.from not equal provider', async () => {
    seedJob();
    mocks.client.getTransaction.mockResolvedValue({ from: otherProvider });

    const res = await post(validBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('submit_tx_provider_mismatch');
  });

  it('accepts valid submit_tx and updates fields', async () => {
    seedJob();

    const res = await post(validBody());
    const row = mocks.rows.get('job-1')!;

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(row.status).toBe('submitted');
    expect(row.output).toEqual({ result: 'done' });
    expect(row.proof).toEqual({ type: 'attestation' });
    expect(row.deliverable_uri).toBe('ipfs://deliverable');
    expect(row.deliverable_hash).toBe(deliverableHash);
    expect(row.proof_uri).toBe('ipfs://proof');
    expect(row.submit_tx).toBe(submitTx);
    expect(row.settlement_status).toBe(3);
    expect(row.submitted_at).toEqual(expect.any(String));
    expect(res.body.receipt.onchainJobId).toBe('42');
    expect(res.body.receipt.settlementStatus).toBe('3');
  });
});
