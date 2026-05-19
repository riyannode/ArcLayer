import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';
import { rankAgentsForJob } from '@/lib/a2a/match-agents';
import { listRosterCandidates } from '@/lib/a2a/roster';

/**
 * POST /api/x402/jobs/[id]/route — x402-gated job routing.
 *
 * Apolo decision engine routes a job to the best available agent
 * via deterministic role/capability scoring (no Math.random).
 * External agents pay 0.01 USDC per routing request.
 *
 * Body (optional): { role?, category?, capabilities? }
 */

export const runtime = 'nodejs';

async function handler(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const jobId = segments[segments.indexOf('jobs') + 1];

  if (!jobId || jobId === '[id]') {
    return NextResponse.json({ ok: false, error: 'missing_job_id' }, { status: 400 });
  }

  let body: { role?: string; category?: string; capabilities?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const roster = await listRosterCandidates();

  // Fallback: seed agents always available even if DB is empty
  const SEED_AGENTS = [
    {
      agentId: 'hermes-trader',
      name: 'Hermes',
      role: 'trader',
      capability: ['execution', 'signal'],
      categories: ['trading'],
      x402: { enabled: true },
    },
    {
      agentId: 'pythia-oracle',
      name: 'Pythia',
      role: 'oracle',
      capability: ['signal', 'forecast'],
      categories: ['data'],
      x402: { enabled: true },
    },
    {
      agentId: 'apolo-resolver',
      name: 'Apolo',
      role: 'resolver',
      capability: ['decision', 'routing'],
      categories: ['orchestration'],
      x402: { enabled: true },
    },
  ];

  // Merge: dynamic registry + seed (deduplicate by agentId)
  const seen = new Set(roster.map((r) => r.agentId));
  const merged = [...roster, ...SEED_AGENTS.filter((s) => !seen.has(s.agentId))];

  const ranked = rankAgentsForJob(
    {
      role: body.role,
      category: body.category,
      capabilities: body.capabilities ?? [],
    },
    merged,
  );

  if (ranked.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'no_matching_agent',
      jobId,
      criteria: body,
    }, { status: 404 });
  }

  const selected = ranked[0];
  const confidence = Math.min(1, selected.score / 100);

  return NextResponse.json({
    ok: true,
    paid: true,
    routing: {
      jobId,
      selectedAgent: {
        id: selected.agentId,
        name: selected.name,
        role: selected.role,
        score: selected.score,
      },
      candidates: ranked.slice(0, 3).map((r) => ({
        id: r.agentId,
        name: r.name,
        score: r.score,
      })),
      routedBy: 'apolo-decision-engine',
      confidence,
      routedAt: new Date().toISOString(),
    },
  });
}

// 0.01 USDC = 10000 atomic (6 decimals)
export const POST = withX402(handler, {
  amount: '10000',
  resource: '/api/x402/jobs/[id]/route',
  description: 'Route a job to the best available agent via Apolo deterministic matcher',
});
