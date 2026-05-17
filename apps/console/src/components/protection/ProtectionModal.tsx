"use client";

import type { ProtectionNotice } from "./types";

type Props = {
  notice: ProtectionNotice;
  onClose: () => void;
};

const severityStyles: Record<ProtectionNotice["severity"], { badge: string; glow: string; label: string }> = {
  info: { badge: "border-sky-400/30 bg-sky-400/10 text-sky-200", glow: "shadow-sky-500/10", label: "Info" },
  success: { badge: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200", glow: "shadow-emerald-500/10", label: "Verified" },
  warning: { badge: "border-[#C5A67C]/40 bg-[#C5A67C]/10 text-[#F2D8A8]", glow: "shadow-[#C5A67C]/10", label: "Protection" },
  error: { badge: "border-red-400/30 bg-red-400/10 text-red-200", glow: "shadow-red-500/10", label: "Action blocked" },
  protection: { badge: "border-[#C5A67C]/50 bg-[#C5A67C]/15 text-[#F7DCA8]", glow: "shadow-[#C5A67C]/20", label: "x402 protection" },
};

export function ProtectionModal({ notice, onClose }: Props) {
  const styles = severityStyles[notice.severity];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-labelledby={`protection-title-${notice.id}`}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full max-w-lg rounded-2xl border border-[#C5A67C]/25 bg-[#070707] p-6 shadow-2xl ${styles.glow}`}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close protection notice"
          className="absolute right-4 top-4 rounded-full border border-white/10 px-2 py-1 text-xs text-white/80 transition hover:border-white/20 hover:text-white"
        >
          ✕
        </button>

        <div className="mb-4 flex items-center gap-3">
          <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${styles.badge}`}>
            {styles.label}
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-[#C5A67C]/30 to-transparent" />
        </div>

        <h2 id={`protection-title-${notice.id}`} className="text-2xl font-semibold tracking-tight text-white">
          {notice.title}
        </h2>
        {notice.subtitle && <p className="mt-1 text-sm font-medium text-[#C5A67C]">{notice.subtitle}</p>}
        <p className="mt-4 text-sm leading-6 text-white/78">{notice.message}</p>

        {notice.technicalDetail && (
          <div className="mt-5 rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <div className="mb-1 text-[10px] uppercase tracking-[0.22em] text-white/80">Technical detail</div>
            <code className="break-words text-xs text-white/80">{notice.technicalDetail}</code>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          {notice.actionHref && notice.actionLabel && (
            <a
              href={notice.actionHref}
              className="rounded-lg border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-4 py-2 text-sm font-medium text-[#F7DCA8] transition hover:bg-[#C5A67C]/15"
            >
              {notice.actionLabel}
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/75 transition hover:border-white/20 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
