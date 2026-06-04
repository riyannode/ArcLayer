import { NextResponse } from 'next/server';
import { getAgentPresenceById } from '@/lib/a2a/live-events';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function deriveStatus(
  lastHeartbeatAt: string | null,
  updatedAt: string | null,
): 'online' | 'offline' {
  const ts = lastHeartbeatAt || updatedAt;
  if (!ts) return 'offline';
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return 'offline';
  return Date.now() - t < ONLINE_THRESHOLD_MS ? 'online' : 'offline';
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params;

  try {
    const presence = await getAgentPresenceById(agentId);

    if (!presence) {
      return NextResponse.json({
        ok: true,
        agentId,
        status: 'offline',
        lastSeenAt: null,
        role: null,
        runtimeType: null,
        processName: null,
        version: null,
        chainId: null,
        rpcOk: null,
      });
    }

    const status = deriveStatus(presence.lastHeartbeatAt, presence.updatedAt);

    return NextResponse.json({
      ok: true,
      agentId: presence.agentId,
      status,
      lastSeenAt: presence.lastHeartbeatAt || presence.updatedAt,
      role: presence.role,
      runtimeType: presence.runtimeType,
      processName: presence.processName,
      version: presence.version,
      chainId: presence.chainId,
      rpcOk: presence.rpcOk,
    });
  } catch {
    return NextResponse.json({
      ok: false,
      agentId,
      status: 'unknown',
      lastSeenAt: null,
      role: null,
      runtimeType: null,
      processName: null,
      version: null,
      chainId: null,
      rpcOk: null,
    });
  }
}
