import { NextResponse } from 'next/server';
import {
  isErc8183CommerceAgent,
  toDashboardAgentRow,
} from '@/lib/dashboard/erc8183-agents';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120';

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const allowedHosts = new Set(['localhost', '127.0.0.1']);
    return (url.protocol === 'http:' || url.protocol === 'https:') && allowedHosts.has(url.hostname);
  } catch {
    return false;
  }
}

function resolveSafeBaseOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured && isAllowedOrigin(configured)) {
    return new URL(configured).origin;
  }

  const requestOrigin = new URL(request.url).origin;
  if (isAllowedOrigin(requestOrigin)) {
    return requestOrigin;
  }

  throw new Error('invalid_origin_for_internal_fetch');
}

export async function GET(request: Request) {
  try {
    const baseOrigin = resolveSafeBaseOrigin(request);
    const agentsUrl = new URL('/api/a2a/agents', baseOrigin);

    const res = await fetch(agentsUrl, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`canonical_agents_failed:${res.status}`);
    }

    const data = await res.json();
    const rawAgents = Array.isArray(data?.agents) ? data.agents : [];

    const agents = rawAgents
      .filter((agent: any) => isErc8183CommerceAgent(agent))
      .map((agent: any) => toDashboardAgentRow(agent))
      .filter((agent: any) => agent.id.length > 0);

    return NextResponse.json(
      {
        ok: true,
        source: 'canonical-a2a-agents',
        dashboard: 'erc8183-commerce',
        canonicalMode: data?.canonicalMode || null,
        totalCanonicalVisible: rawAgents.length,
        totalVisible: agents.length,
        agents,
        timestamp: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erc8183_dashboard_agents_failed';

    return NextResponse.json(
      {
        ok: false,
        source: 'canonical-a2a-agents',
        dashboard: 'erc8183-commerce',
        agents: [],
        totalVisible: 0,
        error: 'erc8183_dashboard_agents_failed',
        detail: message,
        timestamp: new Date().toISOString(),
      },
      {
        status: 502,
        headers: { 'Cache-Control': 'no-store, no-cache, max-age=0' },
      },
    );
  }
}
