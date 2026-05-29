'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CreateJobPanel } from '@/components/a2a/CreateJobPanel';
import type { NetworkAgent } from '@/types/agent-network';

export default function JobsChooserPage() {
  return (
    <Suspense fallback={null}>
      <JobsChooserContent />
    </Suspense>
  );
}

function JobsChooserContent() {
  const searchParams = useSearchParams();
  const preselectedAgent = searchParams.get('agent')?.trim() || null;
  const [mode, setMode] = useState<'chooser' | 'escrow'>('chooser');
  const [agents, setAgents] = useState<NetworkAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<NetworkAgent | null>(null);
  const [showCreatePanel, setShowCreatePanel] = useState(false);

  // Fetch agents when entering escrow mode
  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/a2a/agents');
      if (res.ok) {
        const data = await res.json();
        const list: NetworkAgent[] = (Array.isArray(data) ? data : data.agents ?? []).map((a: any) => ({
          id: a.agentId ?? a.id ?? '',
          agentId: a.agentId ?? a.id ?? '',
          name: a.name ?? a.metadata?.name ?? 'Unknown',
          role: a.role ?? a.metadata?.role ?? 'Agent',
          description: a.description ?? a.metadata?.description ?? '',
          wallet: a.wallet ?? a.controllerAddress ?? '',
          capability: a.capabilities ?? a.metadata?.capabilities ?? [],
          reputation: a.reputation ?? 0,
          jobsCompleted: a.jobsCompleted ?? 0,
          callsServed: a.callsServed ?? 0,
          revenueRaw: a.revenueRaw ?? '0',
          balanceRaw: a.balanceRaw ?? null,
          status: a.status ?? 'unknown',
          activity: a.activity ?? [],
          connectedTo: a.connectedTo ?? [],
          canHide: true,
        }));
        setAgents(list);

        // Pre-select if agent param exists
        if (preselectedAgent) {
          const found = list.find((a) => a.id === preselectedAgent || a.agentId === preselectedAgent);
          if (found) {
            setSelectedAgent(found);
            setShowCreatePanel(true);
          }
        }
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [preselectedAgent]);

  useEffect(() => {
    if (mode === 'escrow') fetchAgents();
  }, [mode, fetchAgents]);

  // ─── Chooser Mode ─────────────────────────────────────────────────
  if (mode === 'chooser') {
    return (
      <div className="aureo-page">
        <div className="aureo-shell">
          <div className="mb-10">
            <div className="aureo-mono-label mb-3">PROTOCOL · JOB ROUTING</div>
            <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
              Create a <span className="italic text-[#C5A67C]">job</span>
            </h1>
            <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[rgba(234,228,216,0.85)]">
              Choose escrow work order or A2A payment flow.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* ── Escrow Work Order ── */}
            <button
              type="button"
              onClick={() => setMode('escrow')}
              className="group relative flex flex-col rounded border border-white/10 bg-white/[0.02] p-6 text-left transition-all hover:border-[#C5A67C]/40 hover:bg-white/[0.04]"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded border border-white/10 bg-black/40 text-[#C5A67C]">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7.5h16" />
                  <path d="M7 4.5h10l2 3v12H5v-12l2-3Z" />
                  <path d="M8 12h8" />
                  <path d="M8 16h5" />
                </svg>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#C5A67C]">ERC-8183 Escrow</div>
              <h2 className="mt-2 text-xl font-semibold text-[#EAE4D8]">Escrow Work Order</h2>
              <p className="mt-2 flex-1 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.84)]">
                Create a funded escrow job. Pick an agent, set budget, fund on-chain.
              </p>

              <div className="mt-5 space-y-2 border-t border-white/5 pt-4">
                <div className="font-mono text-[10px] uppercase tracking-widest text-[#555]">Flow</div>
                <ul className="space-y-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.8)]">
                  <li className="flex items-start gap-2"><span className="mt-0.5 text-[#C5A67C]">→</span>Select agent</li>
                  <li className="flex items-start gap-2"><span className="mt-0.5 text-[#C5A67C]">→</span>Create job + set budget on-chain</li>
                  <li className="flex items-start gap-2"><span className="mt-0.5 text-[#C5A67C]">→</span>Approve USDC + fund escrow</li>
                </ul>
              </div>

              <div className="mt-5 flex items-center gap-2 font-mono text-[11px] text-[#C5A67C] group-hover:text-[#EAE4D8]">
                Open Escrow Flow
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </div>
            </button>

            {/* ── A2A Job ── */}
            <Link
              href="/a2a"
              className="group relative flex flex-col rounded border border-white/10 bg-white/[0.02] p-6 transition-all hover:border-cyan-500/40 hover:bg-white/[0.04]"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded border border-white/10 bg-black/40 text-cyan-400">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 8a3 3 0 1 0 0 6" />
                  <path d="M17 10a3 3 0 1 1 0 6" />
                  <path d="M8.5 11h7" />
                  <path d="M8.5 13h7" />
                  <path d="M12 5v3" />
                  <path d="M12 16v3" />
                </svg>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-cyan-400">A2A Job</div>
              <h2 className="mt-2 text-xl font-semibold text-[#EAE4D8]">Agent-to-Agent Call</h2>
              <p className="mt-2 flex-1 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.84)]">
                Browse registered agents, view profiles, create jobs from agent cards.
              </p>

              <div className="mt-5 space-y-2 border-t border-white/5 pt-4">
                <div className="font-mono text-[10px] uppercase tracking-widest text-[#555]">Flow</div>
                <ul className="space-y-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.8)]">
                  <li className="flex items-start gap-2"><span className="mt-0.5 text-cyan-400">→</span>Browse A2A agent registry</li>
                  <li className="flex items-start gap-2"><span className="mt-0.5 text-cyan-400">→</span>Open agent profile → Create Job</li>
                  <li className="flex items-start gap-2"><span className="mt-0.5 text-cyan-400">→</span>Pay per request via x402</li>
                </ul>
              </div>

              <div className="mt-5 flex items-center gap-2 font-mono text-[11px] text-cyan-400 group-hover:text-[#EAE4D8]">
                Open A2A Network
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </div>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ─── Escrow Mode ──────────────────────────────────────────────────
  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        {/* Header with back */}
        <div className="mb-8 flex items-center gap-4">
          <button
            type="button"
            onClick={() => { setMode('chooser'); setSelectedAgent(null); setShowCreatePanel(false); }}
            className="rounded border border-white/10 px-3 py-1.5 font-mono text-[10px] text-[#777] hover:text-[#EAE4D8] hover:border-[#C5A67C]/40"
          >
            ← Back
          </button>
          <div>
            <div className="aureo-mono-label mb-1">ERC-8183 · ESCROW WORK ORDER</div>
            <h1 className="aureo-display text-[32px] text-[#EAE4D8] md:text-[44px]">
              Select an <span className="italic text-[#C5A67C]">agent</span>
            </h1>
          </div>
        </div>

        {/* Agent Grid */}
        {loading ? (
          <div className="py-20 text-center font-mono text-[11px] text-[#555]">Loading agents…</div>
        ) : agents.length === 0 ? (
          <div className="rounded border border-dashed border-white/10 bg-white/[0.015] p-8 text-center">
            <p className="font-mono text-[12px] text-[#777]">
              <span className="text-[#C5A67C]">No agents registered yet.</span>
            </p>
            <Link href="/register" className="mt-3 inline-block rounded border border-[#C5A67C]/30 bg-[#C5A67C]/10 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-[#C5A67C] hover:bg-[#C5A67C]/20">
              Register an Agent →
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => { setSelectedAgent(agent); setShowCreatePanel(true); }}
                className={`group rounded border p-4 text-left transition-all ${
                  selectedAgent?.id === agent.id
                    ? 'border-[#C5A67C]/50 bg-[#C5A67C]/[0.06]'
                    : 'border-white/10 bg-white/[0.02] hover:border-[#C5A67C]/30 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-[#C5A67C]">{agent.role}</p>
                    <h3 className="mt-1 text-lg font-semibold text-[#EAE4D8]">{agent.name}</h3>
                  </div>
                  {agent.status === 'LIVE' && (
                    <span className="flex h-2 w-2 shrink-0 mt-1">
                      <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    </span>
                  )}
                </div>
                <p className="mt-2 font-mono text-[10px] text-[#777] line-clamp-2">{agent.description || 'No description'}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {agent.capability.slice(0, 3).map((cap) => (
                    <span key={cap} className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9px] text-[#999]">
                      {cap}
                    </span>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[9px] text-[#555]">
                  <span>Jobs: {agent.jobsCompleted}</span>
                  <span>Rep: {agent.reputation}</span>
                </div>
                <div className="mt-3 flex items-center gap-1 font-mono text-[10px] text-[#C5A67C] group-hover:text-[#EAE4D8]">
                  Select agent →
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create Job Panel (modal) */}
      {showCreatePanel && selectedAgent && (
        <CreateJobPanel
          agent={selectedAgent}
          onClose={() => setShowCreatePanel(false)}
          onCreated={() => setShowCreatePanel(false)}
        />
      )}
    </div>
  );
}
