'use client';

import { useEffect, useState } from 'react';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { WorkActionModal, type WorkActionKind, type WorkActionMetadata } from './WorkActionModal';

type VaultJob = {
  id: string;
  on_chain_job_id?: string | null;
  client_address: string;
  jobber_address?: string | null;
  total_amount: number | string;
  status: string;
  duration_tier?: string | null;
  tx_hash_create?: string | null;
  created_at?: string;
};

type Milestone = {
  id: string;
  job_id: string;
  milestone_index: number;
  title?: string | null;
  amount: number | string;
  percentage_bps?: number | null;
  status: 'created' | 'submitted' | 'rejected' | 'released' | 'disputed' | string;
  revisions?: number | null;
  deliverable_uri?: string | null;
  feedback_uri?: string | null;
  approve_deadline?: string | null;
};

type LoadedJob = VaultJob & { milestones?: Milestone[] };

type ModalState = {
  open: boolean;
  kind: WorkActionKind;
  jobId: string;
  milestoneIndex: number;
};

const CLOSED_MODAL: ModalState = { open: false, kind: 'submit', jobId: '', milestoneIndex: 0 };

export function MilestoneProgressPanel() {
  const { address, isConnected } = useArcWallet();
  const { authFetch } = useAuthFetch();
  const [jobs, setJobs] = useState<LoadedJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [modal, setModal] = useState<ModalState>(CLOSED_MODAL);

  async function loadJobs() {
    if (!address) return;
    setLoading(true);
    setMsg('');
    try {
      const res = await authFetch('/api/vault/jobs?role=all');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setJobs(json.jobs || []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isConnected) void loadJobs();
  }, [isConnected, address]);

  // Approve has no body to collect — straight POST.
  async function approve(jobId: string, mid: number) {
    if (!address) return;
    const key = `${jobId}-${mid}-approve`;
    setBusy(key);
    setMsg('');
    try {
      const res = await authFetch(`/api/vault/jobs/${jobId}/milestones/${mid}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'approve' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMsg(`APPROVE ok${json.autoFinal ? ` · AI final: ${json.aiDecision?.decision}` : ''}`);
      await loadJobs();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  function openModal(kind: WorkActionKind, jobId: string, mid: number) {
    setModal({ open: true, kind, jobId, milestoneIndex: mid });
  }

  async function submitFromModal(uri: string, _meta: WorkActionMetadata) {
    const { kind, jobId, milestoneIndex } = modal;
    const key = `${jobId}-${milestoneIndex}-${kind}`;
    setBusy(key);
    setMsg('');
    try {
      const payload: Record<string, string> = { action: kind };
      if (kind === 'submit') payload.deliverableUri = uri;
      if (kind === 'reject') payload.feedbackUri = uri;
      if (kind === 'dispute') payload.reasonUri = uri;

      const res = await authFetch(`/api/vault/jobs/${jobId}/milestones/${milestoneIndex}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMsg(`${kind.toUpperCase()} ok${json.autoFinal ? ` · AI final: ${json.aiDecision?.decision}` : ''}`);
      setModal(CLOSED_MODAL);
      await loadJobs();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Action failed');
      throw e; // let modal show inline error too
    } finally {
      setBusy(null);
    }
  }

  if (!isConnected) {
    return (
      <div className="aureo-panel p-5">
        <div className="aureo-mono-label">VAULT · MILESTONES</div>
        <p className="mt-2 font-mono text-[11px] text-[rgba(234,228,216,0.65)]">Connect wallet to view milestone jobs.</p>
      </div>
    );
  }

  return (
    <div className="aureo-panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="aureo-mono-label">VAULT · MILESTONE PROGRESS</div>
          <h3 className="aureo-display mt-1 text-[24px] text-[#EAE4D8]">Submit · approve · dispute</h3>
        </div>
        <button onClick={loadJobs} disabled={loading} className="btn-secondary px-4 py-2 text-[10px]">
          {loading ? 'LOADING…' : 'REFRESH'}
        </button>
      </div>

      {msg && <div className="mt-4 rounded-none border border-white/10 bg-black/25 px-3 py-2 font-mono text-[11px] text-[#C5A67C]">{msg}</div>}

      <div className="mt-4 space-y-4">
        {jobs.length === 0 && !loading && (
          <div className="rounded-none border border-white/10 bg-black/20 p-4 font-mono text-[11px] text-[rgba(234,228,216,0.55)]">No vault jobs found for this wallet.</div>
        )}

        {jobs.map((job) => {
          const isClient = address?.toLowerCase() === job.client_address?.toLowerCase();
          const isJobber = address?.toLowerCase() === job.jobber_address?.toLowerCase();
          return (
            <div key={job.id} className="rounded-none border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[rgba(234,228,216,0.5)]">Job {job.id.slice(0, 8)} · {job.status}</div>
                  <div className="mt-1 font-mono text-[13px] text-[#EAE4D8]">${Number(job.total_amount).toFixed(2)} USDC {job.on_chain_job_id ? `· On-chain #${job.on_chain_job_id}` : ''}</div>
                </div>
                <div className="font-mono text-[10px] text-[rgba(234,228,216,0.55)]">Role: {isClient ? 'Approver' : isJobber ? 'Agent' : 'Observer'}</div>
              </div>

              <div className="mt-3 space-y-2">
                {(job.milestones || []).map((m) => {
                  const canSubmit = isJobber && ['created', 'rejected'].includes(m.status);
                  const canApprove = isClient && m.status === 'submitted';
                  const canReject = isClient && m.status === 'submitted';
                  const canDispute = (isClient || isJobber) && m.status === 'submitted';
                  const keyBase = `${job.id}-${m.milestone_index}`;
                  return (
                    <div key={m.id} className="rounded-none border border-white/10 bg-black/25 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#C5A67C]">#{m.milestone_index + 1} · {m.status}</div>
                          <div className="mt-1 font-mono text-[12px] text-[#EAE4D8]">{m.title || 'Milestone'} · ${Number(m.amount).toFixed(2)}</div>
                          {m.deliverable_uri && <div className="mt-1 break-all font-mono text-[9.5px] text-[rgba(234,228,216,0.5)]">Deliverable: {m.deliverable_uri}</div>}
                          {m.feedback_uri && <div className="mt-1 break-all font-mono text-[9.5px] text-[rgba(234,228,216,0.5)]">Feedback: {m.feedback_uri}</div>}
                          {m.approve_deadline && <div className="mt-1 font-mono text-[9.5px] text-[rgba(234,228,216,0.45)]">Approve deadline: {new Date(m.approve_deadline).toLocaleString()}</div>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {canSubmit && <button disabled={!!busy} onClick={() => openModal('submit', job.id, m.milestone_index)} className="btn-secondary px-3 py-1 text-[9px]">{busy === `${keyBase}-submit` ? '…' : 'SUBMIT WORK'}</button>}
                          {canApprove && <button disabled={!!busy} onClick={() => approve(job.id, m.milestone_index)} className="btn-secondary px-3 py-1 text-[9px]">{busy === `${keyBase}-approve` ? '…' : 'APPROVE'}</button>}
                          {canReject && <button disabled={!!busy} onClick={() => openModal('reject', job.id, m.milestone_index)} className="btn-secondary px-3 py-1 text-[9px]">REJECT</button>}
                          {canDispute && <button disabled={!!busy} onClick={() => openModal('dispute', job.id, m.milestone_index)} className="btn-secondary px-3 py-1 text-[9px]">DISPUTE</button>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <WorkActionModal
        open={modal.open}
        kind={modal.kind}
        jobId={modal.jobId}
        milestoneIndex={modal.milestoneIndex}
        walletAddress={address ?? undefined}
        busy={!!busy}
        onClose={() => setModal(CLOSED_MODAL)}
        onSubmit={submitFromModal}
      />
    </div>
  );
}
