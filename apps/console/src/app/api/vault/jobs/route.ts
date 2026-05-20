import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { withWalletAuth } from '@/lib/auth/wallet-auth';
import { ARC_VAULT_ADDRESS, USDC_DECIMALS } from '@/lib/vault/constants';
import arcVaultAbiJson from '@/lib/vault/abi/arc-vault.json';
import { createPublicClient, decodeEventLog, getAddress, http, keccak256, parseUnits, toHex } from 'viem';

const ARC_RPC = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
const arcVaultAbi = arcVaultAbiJson as Parameters<typeof decodeEventLog>[0]['abi'];

async function verifyVaultCreateTx(input: {
  txHash?: string;
  expectedClient: `0x${string}`;
  expectedAmount: bigint;
  expectedSpecHash?: string;
  expectedJobId?: string;
}) {
  if (!input.txHash || !/^0x[a-fA-F0-9]{64}$/.test(input.txHash)) {
    return { ok: false as const, error: 'valid ArcVault create tx hash required' };
  }

  const client = createPublicClient({ transport: http(ARC_RPC) });
  const receipt = await client.getTransactionReceipt({ hash: input.txHash as `0x${string}` }).catch(() => null);
  if (!receipt) return { ok: false as const, error: 'create tx receipt not found' };
  if (receipt.status !== 'success') return { ok: false as const, error: 'create tx reverted' };

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ARC_VAULT_ADDRESS.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: arcVaultAbi, data: log.data, topics: log.topics }) as unknown as {
        eventName: string;
        args: { jobId: bigint; client: `0x${string}`; totalAmount: bigint; specHash: `0x${string}` };
      };
      if (decoded.eventName !== 'JobCreated') continue;

      const chainJobId = decoded.args.jobId.toString();
      if (getAddress(decoded.args.client) !== getAddress(input.expectedClient)) {
        return { ok: false as const, error: 'create tx client does not match authenticated wallet' };
      }
      if (decoded.args.totalAmount !== input.expectedAmount) {
        return { ok: false as const, error: 'create tx totalAmount does not match request' };
      }
      if (input.expectedSpecHash && decoded.args.specHash.toLowerCase() !== input.expectedSpecHash.toLowerCase()) {
        return { ok: false as const, error: 'create tx specHash does not match request' };
      }
      if (input.expectedJobId && chainJobId !== input.expectedJobId) {
        return { ok: false as const, error: 'create tx jobId does not match request' };
      }
      return { ok: true as const, onChainJobId: chainJobId };
    } catch {
      // Skip non-ArcVault JobCreated logs.
    }
  }

  return { ok: false as const, error: 'ArcVault JobCreated event not found in create tx' };
}

// GET /api/vault/jobs — read-only list jobs for wallet query param
// POST /api/vault/jobs — create a new job (V1 deposit), wallet-auth protected
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')?.trim().toLowerCase();
  const role = req.nextUrl.searchParams.get('role') || 'client'; // client | jobber | all
  const status = req.nextUrl.searchParams.get('status'); // optional filter

  if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'valid wallet query param required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  let query = supabase.from('vault_jobs').select('*');

  if (role === 'client') {
    query = query.ilike('client_address', wallet);
  } else if (role === 'jobber') {
    query = query.ilike('jobber_address', wallet);
  } else {
    query = query.or(`client_address.ilike.${wallet},jobber_address.ilike.${wallet}`);
  }

  if (status) query = query.eq('status', status);
  query = query.order('created_at', { ascending: false }).limit(50);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach milestones to each job
  if (data && data.length > 0) {
    const jobIds = data.map((j: { id: string }) => j.id);
    const { data: milestones } = await supabase
      .from('vault_milestones')
      .select('*')
      .in('job_id', jobIds)
      .order('milestone_index', { ascending: true });

    const msMap = new Map<string, typeof milestones>();
    for (const m of milestones || []) {
      const arr = msMap.get(m.job_id) || [];
      arr.push(m);
      msMap.set(m.job_id, arr);
    }
    for (const job of data) {
      (job as Record<string, unknown>).milestones = msMap.get(job.id) || [];
    }
  }

  return NextResponse.json({ jobs: data });
}

export const POST = withWalletAuth(async (req: NextRequest, { wallet }) => {
  const body = await req.json() as {
    clientAddress?: string;
    jobberAddress?: string;
    totalAmount: string | number;
    specHash?: string;
    specJson: unknown;
    milestones: Array<{ index?: number; title?: string; description?: string; amount: string | number; deadlineSubmit?: string }>;
    jobDeadline?: string;
    durationTier?: string;
    onChainJobId?: string;
    txHashes?: { approve?: string; deposit?: string; create?: string };
    txHash?: string; // legacy compat
  };

  const totalAmount = Number(body.totalAmount);

  // Validate
  if (!totalAmount || !body.milestones?.length) {
    return NextResponse.json({ error: 'missing required fields (totalAmount, milestones)' }, { status: 400 });
  }
  if (body.milestones.length > 10) {
    return NextResponse.json({ error: 'max 10 milestones' }, { status: 400 });
  }

  const sum = body.milestones.reduce((s, m) => s + Number(m.amount), 0);
  if (Math.abs(sum - totalAmount) > 0.01) {
    return NextResponse.json({ error: 'milestone amounts must sum to totalAmount' }, { status: 400 });
  }

  // Check min 10% per milestone (only for multi-milestone)
  if (body.milestones.length > 1) {
    for (const m of body.milestones) {
      const pct = (Number(m.amount) / totalAmount) * 10000;
      if (pct < 1000) {
        return NextResponse.json({ error: `milestone "${m.title || m.description}" is below 10% minimum` }, { status: 400 });
      }
    }
  }

  // M4: spec_hash verification — must match frontend and ArcVault contract
  if (body.specHash && body.specJson) {
    const computed = keccak256(toHex(JSON.stringify(body.specJson)));
    if (computed.toLowerCase() !== body.specHash.toLowerCase()) {
      return NextResponse.json(
        { error: 'spec_hash mismatch (computed vs supplied)' },
        { status: 400 },
      );
    }
  }

  // M5: On-chain verification — verify ArcVault.createJob tx receipt before DB insert.
  // This prevents spoofed onChainJobId / txHashes from being indexed.
  const createTxHash = body.txHashes?.create || body.txHash;
  const verification = await verifyVaultCreateTx({
    txHash: createTxHash,
    expectedClient: wallet,
    expectedAmount: parseUnits(String(totalAmount), USDC_DECIMALS),
    expectedSpecHash: body.specHash || undefined,
    expectedJobId: body.onChainJobId || undefined,
  });
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error }, { status: 400 });
  }
  // Use verified on-chain job ID (overrides any client-supplied value)
  const verifiedOnChainJobId = verification.onChainJobId;

  // Determine duration tier
  let durationTier = body.durationTier || 'single_payout';
  if (body.milestones.length > 1) durationTier = 'milestone';

  const supabase = getSupabaseAdmin();

  // Insert job — client_address is FORCED to authenticated wallet (cannot spoof)
  const { data: job, error: jobErr } = await supabase.from('vault_jobs').insert({
    client_address: wallet,
    jobber_address: body.jobberAddress?.toLowerCase() || null,
    total_amount: totalAmount,
    milestone_count: body.milestones.length,
    duration_tier: durationTier,
    status: 'open_pool',
    spec_hash: body.specHash || null,
    spec_json: body.specJson,
    deadline: body.jobDeadline || null,
    on_chain_job_id: verifiedOnChainJobId,
    tx_hash_create: createTxHash,
    tx_hash_deposit: body.txHashes?.deposit || null,
    tx_hash_approve: body.txHashes?.approve || null,
  }).select().single();

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  // Insert milestones
  const milestoneRows = body.milestones.map((m, i) => ({
    job_id: job.id,
    milestone_index: m.index ?? i,
    amount: Number(m.amount),
    percentage_bps: Math.round((Number(m.amount) / totalAmount) * 10000),
    title: m.title || m.description || `Milestone ${i + 1}`,
    deadline_submit: m.deadlineSubmit || null,
    status: 'created',
  }));

  const { error: msErr } = await supabase.from('vault_milestones').insert(milestoneRows);
  if (msErr) return NextResponse.json({ error: msErr.message }, { status: 500 });

  return NextResponse.json({ jobId: job.id, job, milestones: milestoneRows }, { status: 201 });
});
