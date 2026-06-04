'use client';

import { useEffect, useState, useCallback } from 'react';

type BotHealth = {
  ok: boolean;
  agentId: string;
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt: string | null;
  role: string | null;
  runtimeType: string | null;
  processName: string | null;
  version: string | null;
  chainId: number | null;
  rpcOk: boolean | null;
};

const REFRESH_MS = 45_000; // poll every 45s

function ageLabel(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

const STATUS_STYLES: Record<string, { dot: string; pill: string; text: string }> = {
  online: {
    dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]',
    pill: 'border-emerald-400/25 bg-emerald-400/[0.08]',
    text: 'text-emerald-300',
  },
  offline: {
    dot: 'bg-zinc-500',
    pill: 'border-white/[0.08] bg-white/[0.03]',
    text: 'text-[#EAE4D8]/50',
  },
  unknown: {
    dot: 'bg-zinc-600',
    pill: 'border-white/[0.06] bg-white/[0.02]',
    text: 'text-[#EAE4D8]/35',
  },
};

export function BotStatusPill({
  agentId,
  compact = false,
}: {
  agentId: string;
  compact?: boolean;
}) {
  const [health, setHealth] = useState<BotHealth | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/bot-health`, { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as BotHealth;
      setHealth(json);
    } catch {
      // keep last known state
    }
  }, [agentId]);

  useEffect(() => {
    fetchHealth();
    const timer = setInterval(fetchHealth, REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchHealth]);

  const status = health?.status ?? 'unknown';
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.unknown;
  const label =
    status === 'online' ? 'Bot online' : status === 'offline' ? 'Bot offline' : 'Bot unknown';
  const lastSeen = ageLabel(health?.lastSeenAt ?? null);
  const tooltip = lastSeen ? `Last seen ${lastSeen}` : undefined;

  return (
    <span
      title={tooltip}
      className={[
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-mono tracking-wide',
        style.pill,
        style.text,
      ].join(' ')}
    >
      <span className={['h-1.5 w-1.5 shrink-0 rounded-full', style.dot].join(' ')} />
      {!compact && <span>{label}</span>}
      {!compact && lastSeen && status === 'online' && (
        <span className="text-[10px] opacity-60">{lastSeen}</span>
      )}
    </span>
  );
}
