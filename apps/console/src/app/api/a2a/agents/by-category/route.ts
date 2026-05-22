import { NextResponse } from 'next/server';
import { listStoredManifests } from '@/lib/a2a/roster';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category')?.trim() || 'prediction-market-bots';

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
    category,
    total: agents.length,
    agents,
    timestamp: new Date().toISOString(),
  });
}
