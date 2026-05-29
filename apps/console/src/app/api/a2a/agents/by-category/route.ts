import { NextResponse } from 'next/server';
import { listLocalIndexerAgentsByCategory } from '@/lib/a2a/local-indexer-roster';
import { listStoredManifests } from '@/lib/a2a/roster';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category')?.trim() || 'prediction-market-bots';
  const source = process.env.A2A_AGENT_ROSTER_SOURCE || 'local-indexer';
  const isAll = category === 'all';

  // Always fetch Supabase manifests for external users
  let supabaseAgents: unknown[] = [];
  let supabaseError: string | null = null;
  try {
    const manifests = await listStoredManifests();
    supabaseAgents = manifests
      .filter((item) => {
        // category=all → return all agents, no filter
        if (isAll) return true;
        const manifest = item.manifest;
        return (
          manifest.categories?.includes(category) ||
          manifest.roles?.some((role: { category?: string }) => role.category === category)
        );
      })
      .map((item) => {
        const manifest = item.manifest;
        return {
          agentId: item.agentId,
          name: manifest.name,
          role: manifest.role,
          endpoint: manifest.endpoint ?? null,
          categories: manifest.categories ?? [],
          roles: manifest.roles ?? [],
          capabilities: manifest.capabilities ?? manifest.capability ?? [],
          x402: manifest.x402 ?? null,
          controller: item.controller,
          updatedAt: item.updatedAt,
          manifestHash: item.manifestHash,
          source: 'supabase',
        };
      });
  } catch {
    supabaseError = 'supabase_unavailable';
  }

  // Local-indexer path: run for prediction-market-bots OR all
  let localAgents: unknown[] = [];
  let localError: string | null = null;
  if ((isAll || category === 'prediction-market-bots') && source !== 'global') {
    try {
      // For 'all', pass 'prediction-market-bots' to the local-indexer
      // since that's the only category it indexes
      localAgents = await listLocalIndexerAgentsByCategory('prediction-market-bots');
    } catch (error) {
      localError = error instanceof Error ? error.message : 'local_indexer_unavailable';
    }
  }

  // Merge: local-indexer agents + Supabase external agents (dedupe by agentId)
  if (source === 'global') {
    return NextResponse.json({
      ok: true,
      source: 'supabase-roster',
      category,
      total: supabaseAgents.length,
      agents: supabaseAgents,
      timestamp: new Date().toISOString(),
    });
  }

  // Merge both sources, Supabase agents not already in local list
  const localIds = new Set(localAgents.map((a) => (a as { agentId: string }).agentId));
  const externalOnly = supabaseAgents.filter(
    (a) => !localIds.has((a as { agentId: string }).agentId)
  );
  const merged = [...localAgents, ...externalOnly];

  return NextResponse.json({
    ok: true,
    source: localError ? 'supabase-roster' : 'merged',
    metadataHost: process.env.A2A_AGENT_METADATA_HOST ?? 'agent.arclayers.xyz',
    indexerUrl: process.env.A2A_LOCAL_INDEXER_URL ?? null,
    category,
    total: merged.length,
    agents: merged,
    localCount: localAgents.length,
    externalCount: externalOnly.length,
    localError: localError ?? null,
    supabaseError,
    timestamp: new Date().toISOString(),
  });
}
