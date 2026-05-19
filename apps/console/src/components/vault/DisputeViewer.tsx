'use client';

import { useEffect, useState } from 'react';
import { useArcWallet } from '@/hooks/useArcWallet';

type AiAnalysis = {
  decision?: string;
  confidence?: number;
  reason?: string;
  matchedCriteria?: string[];
  missingEvidence?: string[];
  recommendedSplit?: { jobberBps?: number; clientBps?: number };
};

type Dispute = {
  id: string;
  job_id: string;
  milestone_id: string;
  initiator_address: string;
  tier: string;
  outcome?: string | null;
  jobber_bps?: number | null;
  client_bps?: number | null;
  reason_uri?: string | null;
  ai_analysis?: AiAnalysis | null;
  ai_confidence?: number | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_at?: string;
  milestone?: { milestone_index: number; title?: string; amount?: number | string; status?: string } | null;
};

export function DisputeViewer() {
  const { address, isConnected } = useArcWallet();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    if (!address) return;
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/vault/disputes?wallet=${address}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setDisputes(json.disputes || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load disputes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isConnected) void load();
  }, [isConnected, address]);

  return (
    <div className="aureo-panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="aureo-mono-label">VAULT · DISPUTE RESOLVER</div>
          <h3 className="aureo-display mt-1 text-[24px] text-[#EAE4D8]">AI resolution</h3>
        </div>
        <button onClick={load} disabled={loading || !isConnected} className="btn-secondary px-4 py-2 text-[10px]">
          {loading ? 'LOADING…' : 'REFRESH'}
        </button>
      </div>

      {!isConnected && <p className="mt-3 font-mono text-[11px] text-[rgba(234,228,216,0.6)]">Connect wallet to view disputes.</p>}
      {err && <div className="mt-4 rounded-none border border-red-400/25 bg-red-400/5 px-3 py-2 font-mono text-[11px] text-red-200">{err}</div>}

      <div className="mt-4 space-y-4">
        {isConnected && disputes.length === 0 && !loading && (
          <div className="rounded-none border border-white/10 bg-black/20 p-4 font-mono text-[11px] text-[rgba(234,228,216,0.55)]">No disputes yet.</div>
        )}

        {disputes.map((d) => {
          const ai = d.ai_analysis || {};
          const confidence = typeof ai.confidence === 'number' ? ai.confidence : d.ai_confidence;
          return (
            <div key={d.id} className="rounded-none border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#C5A67C]">
                    {d.tier?.toUpperCase()} · {d.resolved_by ? `RESOLVED BY ${d.resolved_by.toUpperCase()}` : 'PENDING'}
                  </div>
                  <div className="mt-1 font-mono text-[13px] text-[#EAE4D8]">
                    Job {d.job_id.slice(0, 8)} · Milestone #{(d.milestone?.milestone_index ?? 0) + 1}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-[rgba(234,228,216,0.55)]">
                    Initiator: {d.initiator_address.slice(0, 8)}…{d.initiator_address.slice(-6)}
                  </div>
                </div>
                <div className="rounded-none border border-white/10 bg-black/30 px-3 py-2 text-right">
                  <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[rgba(234,228,216,0.5)]">Decision</div>
                  <div className="mt-1 font-mono text-[13px] text-[#EAE4D8]">{ai.decision || d.outcome || 'escalate'}</div>
                  <div className="font-mono text-[9px] text-[rgba(234,228,216,0.5)]">conf {confidence ?? 0}%</div>
                </div>
              </div>

              <div className="mt-3 rounded-none border border-white/10 bg-black/25 p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[rgba(234,228,216,0.55)]">AI Reasoning</div>
                <p className="mt-2 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.78)]">{ai.reason || 'No AI reasoning stored.'}</p>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-none border border-white/10 bg-black/25 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#B8CD7E]">Matched Criteria</div>
                  <ul className="mt-2 space-y-1 font-mono text-[10px] text-[rgba(234,228,216,0.65)]">
                    {(ai.matchedCriteria || []).length ? ai.matchedCriteria!.map((x, i) => <li key={i}>✓ {x}</li>) : <li>—</li>}
                  </ul>
                </div>
                <div className="rounded-none border border-white/10 bg-black/25 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">Missing Evidence</div>
                  <ul className="mt-2 space-y-1 font-mono text-[10px] text-[rgba(234,228,216,0.65)]">
                    {(ai.missingEvidence || []).length ? ai.missingEvidence!.map((x, i) => <li key={i}>! {x}</li>) : <li>—</li>}
                  </ul>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] text-[rgba(234,228,216,0.55)]">
                <span>Split: jobber {ai.recommendedSplit?.jobberBps ?? d.jobber_bps ?? 0}bps / client {ai.recommendedSplit?.clientBps ?? d.client_bps ?? 0}bps</span>
                {d.reason_uri && <span className="break-all">· reason: {d.reason_uri}</span>}
                {d.resolved_at && <span>· resolved: {new Date(d.resolved_at).toLocaleString()}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
