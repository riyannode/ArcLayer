'use client';

/**
 * /dashboard/external-bot
 *
 * External bot dashboard/status page accessible after onboarding.
 * Query params: ?category=<category>&agentId=<agentId>
 *
 * Shows registered agent IDs, runtime slugs, API key status, manifest status,
 * roster visibility, presence/live event status, copy/download buttons,
 * PM2 command, and live viewer link.
 */

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getAgentCategory } from '@/app/live-a2a-agent/categories';

type DiagCheck = { label: string; status: 'ok' | 'fail' | 'pending'; detail: string };

function DashboardContent() {
  const searchParams = useSearchParams();
  const category = searchParams.get('category') || '';
  const agentId = searchParams.get('agentId') || '';
  const catConfig = category ? getAgentCategory(category) : null;

  const [checks, setChecks] = useState<DiagCheck[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [agents, setAgents] = useState<{ agentId: string; name: string; source?: string }[]>([]);

  const runTestSync = useCallback(async () => {
    if (!category) return;
    setSyncing(true);
    const cat = category;
    const newChecks: DiagCheck[] = [];
    const foundAgents: { agentId: string; name: string; source?: string }[] = [];

    // 1. Roster — /api/a2a/agents/by-category
    try {
      const res = await fetch(`/api/a2a/agents/by-category?category=${encodeURIComponent(cat)}`);
      const data = await res.json();
      const match = agentId
        ? data.agents?.filter((a: { agentId: string }) => a.agentId === agentId) || []
        : data.agents || [];
      foundAgents.push(...match.map((a: { agentId: string; name: string; source: string }) => ({
        agentId: a.agentId,
        name: a.name || a.agentId,
        source: a.source,
      })));

      newChecks.push({
        label: 'Roster Visibility',
        status: match.length > 0 ? 'ok' : 'fail',
        detail: match.length > 0
          ? `${match.length} agents visible · source: ${data.source} · total roster: ${data.total}`
          : `Agent not in roster. source=${data.source}, total=${data.total}. Publish manifest first.`,
      });
    } catch {
      newChecks.push({ label: 'Roster Visibility', status: 'fail', detail: 'API unreachable' });
    }

    // 2. Presence
    try {
      const res = await fetch(`/api/a2a/presence?category=${encodeURIComponent(cat)}`);
      const data = await res.json();
      const match = agentId
        ? data.presence?.filter((p: { agentId: string }) => p.agentId === agentId) || []
        : data.presence || [];
      newChecks.push({
        label: 'Presence',
        status: match.length > 0 ? 'ok' : 'pending',
        detail: match.length > 0
          ? `${match[0]?.status || 'online'} · last: ${match[0]?.lastEventType || 'N/A'}`
          : 'No presence data. Run bot to send heartbeat.',
      });
    } catch {
      newChecks.push({ label: 'Presence', status: 'fail', detail: 'API unreachable' });
    }

    // 3. Live events
    try {
      const res = await fetch(`/api/a2a/live-events?category=${encodeURIComponent(cat)}&limit=10`);
      const data = await res.json();
      const match = agentId
        ? data.events?.filter((e: { agentId: string }) => e.agentId === agentId) || []
        : data.events || [];
      newChecks.push({
        label: 'Live Events',
        status: match.length > 0 ? 'ok' : 'pending',
        detail: `${match.length} events for agent · ${data.total} total in category`,
      });
    } catch {
      newChecks.push({ label: 'Live Events', status: 'fail', detail: 'API unreachable' });
    }

    // 4. Bridge session
    try {
      const res = await fetch('/api/agent-bridge/sessions/latest');
      const data = await res.json();
      newChecks.push({
        label: 'Latest Bridge Session',
        status: data.session ? 'ok' : 'pending',
        detail: data.session
          ? `Session ${data.session.id?.slice(0, 12)}… · ${data.session.totals?.events || 0} events`
          : 'No sessions yet',
      });
    } catch {
      newChecks.push({ label: 'Latest Bridge Session', status: 'fail', detail: 'API unreachable' });
    }

    setChecks(newChecks);
    setAgents(foundAgents);
    setLastSync(new Date().toLocaleTimeString());
    setSyncing(false);
  }, [category, agentId]);

  // Auto-run on mount
  useEffect(() => {
    if (category) runTestSync();
  }, [category, runTestSync]);

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-6 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto max-w-[880px] pt-4 pb-12">
        <header className="mb-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.34em] text-[#C5A67C]">
            ARCLAYER · EXTERNAL BOT DASHBOARD
          </div>
          <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.12em] text-[#F5F0E5] sm:text-4xl">
            Bot Status
          </h1>
          {catConfig && (
            <p className="mt-2 max-w-2xl font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.7)]">
              Category: {catConfig.label}
              {agentId && <span className="ml-3">Agent: {agentId}</span>}
            </p>
          )}
        </header>

        {/* Quick links */}
        <div className="mb-6 flex flex-wrap gap-3">
          <Link
            href="/register/external-bot"
            className="rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15"
          >
            Register New Bot →
          </Link>
          <Link
            href={category ? `/live-a2a-agent/${category}` : '/live-a2a-agent'}
            className="rounded-sm border border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/65 hover:text-[#EAE4D8]"
          >
            Live Viewer →
          </Link>
          <button
            onClick={runTestSync}
            disabled={syncing}
            className="rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15 disabled:opacity-40"
          >
            {syncing ? 'Syncing…' : '🔍 Test Sync'}
          </button>
        </div>

        {lastSync && (
          <div className="mb-4 font-mono text-[9px] text-[#EAE4D8]/40">
            Last sync: {lastSync}
          </div>
        )}

        {/* Agent summary */}
        {agents.length > 0 && (
          <div className="mb-4 rounded-sm border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-300 mb-2">
              Registered Agents
            </div>
            <div className="space-y-2">
              {agents.map((a) => (
                <div key={a.agentId} className="flex items-center justify-between rounded-sm border border-white/10 bg-black/20 p-2">
                  <div>
                    <div className="font-mono text-[10px] text-[#EAE4D8]">{a.name}</div>
                    <div className="font-mono text-[9px] text-[#EAE4D8]/50">ID: {a.agentId}</div>
                  </div>
                  {a.source && (
                    <span className="rounded-sm bg-white/5 px-1.5 py-0.5 font-mono text-[8px] text-[#EAE4D8]/50">
                      {a.source}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Diagnostic checks */}
        {checks.length > 0 && (
          <div className="rounded-sm border border-white/10 bg-black/40 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] mb-3">
              Diagnostics
            </div>
            <div className="space-y-2">
              {checks.map((c, i) => (
                <div key={i} className={`rounded-sm border p-2.5 ${
                  c.status === 'ok' ? 'border-emerald-500/20 bg-emerald-500/5' :
                  c.status === 'fail' ? 'border-red-500/20 bg-red-500/5' :
                  'border-white/10 bg-white/[0.02]'
                }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] text-[#EAE4D8]">{c.label}</div>
                      <div className="mt-0.5 font-mono text-[9px] text-[#EAE4D8]/50 break-words">{c.detail}</div>
                    </div>
                    <span className={`font-mono text-[9px] flex-shrink-0 ${
                      c.status === 'ok' ? 'text-emerald-300' :
                      c.status === 'fail' ? 'text-red-400' :
                      'text-[#EAE4D8]/40'
                    }`}>
                      {c.status === 'ok' ? '✅' : c.status === 'fail' ? '❌' : '⏳'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Deploy guide */}
        <div className="mt-4 rounded-sm border border-cyan-500/20 bg-cyan-500/5 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300 mb-2">
            Deploy Checklist
          </div>
          <ol className="space-y-1.5 font-mono text-[10px] text-[#EAE4D8]/70 list-decimal list-inside">
            <li>Download .env bundle from <Link href="/register/external-bot" className="text-[#C5A67C] underline">Registration page</Link></li>
            <li>Copy .env files to your VPS</li>
            <li>Paste <code className="text-[#C5A67C]">X402_PAYER_PRIVATE_KEY</code> in .env.common</li>
            <li>Paste <code className="text-[#C5A67C]">LLM_API_KEY</code> if your bot uses LLM</li>
            <li>Run: <code className="text-[#C5A67C]">npm install && pm2 start ecosystem.config.cjs</code></li>
            <li>Verify: <code className="text-[#C5A67C]">pm2 status && pm2 logs</code></li>
            <li>Click <strong>Test Sync</strong> after first event cycle</li>
          </ol>
        </div>
      </div>
    </main>
  );
}

// Wrap in Suspense for useSearchParams
export default function DashboardExternalBotPage() {
  return (
    <Suspense fallback={null}>
      <DashboardContent />
    </Suspense>
  );
}
