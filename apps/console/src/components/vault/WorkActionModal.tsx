'use client';

import { useEffect, useState } from 'react';

export type WorkActionKind = 'submit' | 'reject' | 'dispute';

export type WorkActionMetadata = {
  kind: WorkActionKind;
  version: 1;
  title: string;
  body: string;
  proofLink?: string;
  notes?: string;
  submittedAt: string; // ISO timestamp
  submittedBy?: string; // wallet address
};

type Props = {
  open: boolean;
  kind: WorkActionKind;
  jobId: string;
  milestoneIndex: number;
  walletAddress?: string;
  busy?: boolean;
  onClose: () => void;
  /**
   * Returns the URI string the API expects.
   * For now this is `data:application/json;base64,<...>` — no IPFS roundtrip,
   * still verifiable, replayable, and migratable to IPFS later.
   */
  onSubmit: (uri: string, metadata: WorkActionMetadata) => Promise<void> | void;
};

const COPY: Record<WorkActionKind, { title: string; verb: string; bodyLabel: string; bodyPlaceholder: string; helperText: string; cta: string }> = {
  submit: {
    title: 'Submit Work',
    verb: 'Submit',
    bodyLabel: 'Result / Delivery Notes',
    bodyPlaceholder: 'Describe the deliverable. You can use markdown. Approver will see this verbatim.',
    helperText: 'The approver reviews this submission and either releases payment or rejects with feedback.',
    cta: 'Submit work',
  },
  reject: {
    title: 'Reject &amp; Send Feedback',
    verb: 'Reject',
    bodyLabel: 'Feedback / What Needs Fixing',
    bodyPlaceholder: 'Explain what needs to change. The agent gets a chance to resubmit.',
    helperText: 'Rejection sends the milestone back to the agent for revision.',
    cta: 'Send rejection',
  },
  dispute: {
    title: 'Open Dispute',
    verb: 'Dispute',
    bodyLabel: 'Dispute Reason / Evidence',
    bodyPlaceholder: 'Explain why this milestone is disputed. Include links to evidence if any.',
    helperText: 'Disputes are routed to the resolver. Both sides can submit evidence before resolution.',
    cta: 'Open dispute',
  },
};

function buildDataUri(meta: WorkActionMetadata): string {
  const json = JSON.stringify(meta);
  // Browser-safe base64 encode (handles unicode via TextEncoder when available)
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    try {
      const utf8 = new TextEncoder().encode(json);
      let binary = '';
      utf8.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      return `data:application/json;base64,${window.btoa(binary)}`;
    } catch {
      return `data:application/json;base64,${window.btoa(unescape(encodeURIComponent(json)))}`;
    }
  }
  // Should not happen in this client component; keep a readable fallback.
  return `data:application/json,${encodeURIComponent(json)}`;
}

export function WorkActionModal({ open, kind, jobId, milestoneIndex, walletAddress, busy, onClose, onSubmit }: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [proofLink, setProofLink] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [overrideUri, setOverrideUri] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const copy = COPY[kind];

  // Reset on open
  useEffect(() => {
    if (open) {
      setTitle('');
      setBody('');
      setProofLink('');
      setNotes('');
      setOverrideUri('');
      setShowAdvanced(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const previewMetadata: WorkActionMetadata = {
    kind,
    version: 1,
    title: title.trim() || `Milestone #${milestoneIndex + 1} ${copy.verb.toLowerCase()}`,
    body: body.trim(),
    proofLink: proofLink.trim() || undefined,
    notes: notes.trim() || undefined,
    submittedAt: new Date().toISOString(),
    submittedBy: walletAddress,
  };

  async function handleSubmit() {
    setError(null);
    if (overrideUri.trim()) {
      try {
        await onSubmit(overrideUri.trim(), previewMetadata);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      }
      return;
    }
    if (!body.trim()) {
      setError(`${copy.bodyLabel} is required.`);
      return;
    }
    const uri = buildDataUri(previewMetadata);
    try {
      await onSubmit(uri, previewMetadata);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="aureo-panel w-full max-w-[640px] max-h-[92vh] overflow-y-auto p-5 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="aureo-mono-label">VAULT · {copy.verb.toUpperCase()}</div>
            <h3 className="aureo-display mt-1 text-[24px] text-[#EAE4D8]" dangerouslySetInnerHTML={{ __html: copy.title }} />
            <p className="mt-1 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.78)] invisible">
              Job <span className="text-[#C5A67C]">{jobId.slice(0, 8)}</span> · Milestone <span className="text-[#C5A67C]">#{milestoneIndex + 1}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-bordered px-3 py-1.5 text-[10px]"
            aria-label="Close"
          >
            CLOSE
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">TITLE</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Milestone #${milestoneIndex + 1} ${copy.verb.toLowerCase()}`}
              className="input-mono"
              autoFocus
            />
            <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.78)]">Optional. Defaults to a sensible label.</div>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">{copy.bodyLabel.toUpperCase()}</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={copy.bodyPlaceholder}
              className="input-mono min-h-[140px]"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">PROOF LINK</label>
            <input
              value={proofLink}
              onChange={(e) => setProofLink(e.target.value)}
              placeholder="https://github.com/..., ipfs://..., https://drive.google.com/..."
              className="input-mono"
            />
            <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.78)]">Optional external link reviewers can open.</div>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">ADDITIONAL NOTES</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional context for the reviewer (not required)."
              className="input-mono min-h-[80px]"
            />
          </div>

          <details className="border-t border-white/5 pt-3" open={showAdvanced}>
            <summary
              className="cursor-pointer font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.85)] transition hover:text-[rgba(234,228,216,0.65)]"
              onClick={(e) => {
                e.preventDefault();
                setShowAdvanced((v) => !v);
              }}
            >
              Advanced · paste existing URI
            </summary>
            {showAdvanced && (
              <div className="mt-2 space-y-2">
                <input
                  value={overrideUri}
                  onChange={(e) => setOverrideUri(e.target.value)}
                  placeholder="ipfs://Qm..., https://..., data:application/json;base64,..."
                  className="input-mono"
                />
                <div className="font-mono text-[10.5px] text-[rgba(234,228,216,0.65)] invisible">
                  When set, the form fields above are ignored and this URI is sent verbatim. Useful for IPFS-pinned proofs.
                </div>
              </div>
            )}
          </details>

          <div className="rounded-none border border-white/10 bg-black/25 p-3">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.55)]">Auto-generated metadata preview</div>
            <pre className="mt-2 max-h-[180px] overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-5 text-[rgba(234,228,216,0.85)]">
              {JSON.stringify(previewMetadata, null, 2)}
            </pre>
            <div className="mt-2 font-mono text-[10.5px] text-[rgba(234,228,216,0.65)]">
              {copy.helperText}
            </div>
          </div>

          {error && (
            <div className="rounded-none border border-[rgba(230,130,130,0.35)] bg-[rgba(230,130,130,0.06)] p-3 font-mono text-[11px] text-[#f0c5c5]">
              {error}
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn-bordered px-4 py-2 text-[10.5px]">
            CANCEL
          </button>
          <button type="button" onClick={handleSubmit} disabled={busy} className="btn-primary px-4 py-2 text-[10.5px]">
            {busy ? `${copy.verb.toUpperCase()}TING…` : copy.cta.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
