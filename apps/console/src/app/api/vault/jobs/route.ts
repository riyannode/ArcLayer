import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { withWalletAuth } from '@/lib/auth/wallet-auth';
import { keccak256, toHex } from 'viem';

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
    on_chain_job_id: body.onChainJobId || null,
    tx_hash_create: body.txHashes?.create || body.txHash || null,
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
