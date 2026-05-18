import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { withWalletAuth } from '@/lib/auth/wallet-auth';

// GET /api/vault/disputes — list disputes for the authenticated wallet
// Query: ?role=client|jobber|all  (default all)
export const GET = withWalletAuth(async (req: NextRequest, { wallet }) => {
  const role = req.nextUrl.searchParams.get('role') || 'all';
  const supabase = getSupabaseAdmin();

  // Fetch jobs touched by this wallet first to scope disputes
  let jobQuery = supabase.from('vault_jobs').select('id, client_address, jobber_address');
  if (role === 'client') jobQuery = jobQuery.ilike('client_address', wallet);
  else if (role === 'jobber') jobQuery = jobQuery.ilike('jobber_address', wallet);
  else jobQuery = jobQuery.or(`client_address.ilike.${wallet},jobber_address.ilike.${wallet}`);

  const { data: jobs, error: jErr } = await jobQuery;
  if (jErr) return NextResponse.json({ error: jErr.message }, { status: 500 });
  if (!jobs || jobs.length === 0) return NextResponse.json({ disputes: [] });

  const jobIds = jobs.map((j) => j.id);
  const { data: disputes, error: dErr } = await supabase
    .from('vault_disputes')
    .select('*')
    .in('job_id', jobIds)
    .order('created_at', { ascending: false })
    .limit(50);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  // Hydrate with job + milestone summary
  const milestoneIds = (disputes || []).map((d) => d.milestone_id).filter(Boolean);
  const { data: milestones } = await supabase
    .from('vault_milestones')
    .select('id, milestone_index, title, amount, status')
    .in('id', milestoneIds.length ? milestoneIds : ['00000000-0000-0000-0000-000000000000']);
  const msMap = new Map((milestones || []).map((m) => [m.id, m]));
  const jobMap = new Map(jobs.map((j) => [j.id, j]));

  const enriched = (disputes || []).map((d) => ({
    ...d,
    job: jobMap.get(d.job_id) || null,
    milestone: msMap.get(d.milestone_id) || null,
  }));

  return NextResponse.json({ disputes: enriched });
});
