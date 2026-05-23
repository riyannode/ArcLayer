import { NextResponse } from 'next/server';
import { listLocalIndexerAgentsByCategory } from '@/lib/a2a/local-indexer-roster';
import { listStoredManifests } from '@/lib/a2a/roster';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category')?.trim() || 'prediction-market-bots';
  const source = process.env.A2A_AGENT_ROSTER_SOURCE || 'local-indexer';

  if (category === 'prediction-market-bots' && source !== 'global') {
    try {
      const agents = await listLocalIndexerAgentsByCategory(category);

      return NextResponse.json({
        ok: true,
        source: 'local-indexer',
        metadataHost: process.env.A2A_AGENT_METADATA_HOST ?? 'agent.arclayers.xyz',
        indexerUrl: process.env.A2A_LOCAL_INDEXER_URL ?? null,
        category,
        total: agents.length,
        agents,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          source: 'local-indexer',
          metadataHost: process.env.A2A_AGENT_METADATA_HOST ?? 'agent.arclayers.xyz',
          indexerUrl: process.env.A2A_LOCAL_INDEXER_URL ?? null,
          category,
          total: 0,
          agents: [],
          error: 'local_indexer_unavailable',
          message: error instanceof Error ? error.message : 'unknown',
          timestamp: new Date().toISOString(),
        },
        { status: 200 },
      );
    }
  }

  try {
    const manifests = await listStoredManifests();

    const agents = manifests
      .filter((item) => {
        const manifest = item.manifest;
        return (
          manifest.categories?.includes(category) ||
          manifest.roles?.some((role) => role.category === category)
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
        };
      });

    return NextResponse.json({
      ok: true,
      source: 'supabase-roster',
      category,
      total: agents.length,
      agents,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      ok: false,
      source: 'supabase-roster',
      category,
      total: 0,
      agents: [],
      error: 'agents_fetch_failed',
    });
  }
}
