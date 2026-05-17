"use client";

import type { ProtectionNotice } from "./types";

type Props = {
  notice: ProtectionNotice;
  onClose: () => void;
};

const severityStyles: Record<ProtectionNotice["severity"], { badge: string; glow: string; label: string; title: string; message: string; detail: string }> = {
  info: { badge: "border-sky-400/30 bg-sky-400/10 text-sky-200", glow: "shadow-sky-500/10", label: "Info", title: "text-sky-200", message: "text-sky-100/80", detail: "text-sky-100/80" },
  success: { badge: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200", glow: "shadow-emerald-500/10", label: "Verified", title: "text-emerald-300", message: "text-emerald-100/85", detail: "text-emerald-100/80" },
  warning: { badge: "border-[#C5A67C]/40 bg-[#C5A67C]/10 text-[#F2D8A8]", glow: "shadow-[#C5A67C]/10", label: "Protection", title: "text-[#F2D8A8]", message: "text-[#F7DCA8]/80", detail: "text-[#F7DCA8]/75" },
  error: { badge: "border-red-400/40 bg-red-400/10 text-red-200", glow: "shadow-red-500/10", label: "Action blocked", title: "text-red-300", message: "text-red-100/85", detail: "text-red-100/80" },
  protection: { badge: "border-red-400/40 bg-red-400/10 text-red-200", glow: "shadow-red-500/15", label: "x402 protection", title: "text-red-300", message: "text-red-100/85", detail: "text-red-100/80" },
};

const severityDivider: Record<ProtectionNotice["severity"], string> = {
  info: "from-sky-400/30",
  success: "from-emerald-400/30",
  warning: "from-[#C5A67C]/30",
  error: "from-red-400/30",
  protection: "from-red-400/30",
};

const severityDetailBox: Record<ProtectionNotice["severity"], string> = {
  info: "border-sky-400/15 bg-sky-400/[0.03]",
  success: "border-emerald-400/15 bg-emerald-400/[0.03]",
  warning: "border-[#C5A67C]/15 bg-[#C5A67C]/[0.03]",
  error: "border-red-400/15 bg-red-400/[0.03]",
  protection: "border-red-400/15 bg-red-400/[0.03]",
};

const severityDetailLabel: Record<ProtectionNotice["severity"], string> = {
  info: "text-sky-100/70",
  success: "text-emerald-100/70",
  warning: "text-[#F7DCA8]/70",
  error: "text-red-100/70",
  protection: "text-red-100/70",
};

const severityAction: Record<ProtectionNotice["severity"], string> = {
  info: "border-sky-400/35 bg-sky-400/10 text-sky-100 hover:bg-sky-400/15",
  success: "border-emerald-400/35 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15",
  warning: "border-[#C5A67C]/35 bg-[#C5A67C]/10 text-[#F7DCA8] hover:bg-[#C5A67C]/15",
  error: "border-red-400/35 bg-red-400/10 text-red-100 hover:bg-red-400/15",
  protection: "border-red-400/35 bg-red-400/10 text-red-100 hover:bg-red-400/15",
};

const severityFrame: Record<ProtectionNotice["severity"], string> = {
  info: "border-sky-400/30 bg-sky-950/20",
  success: "border-emerald-400/40 bg-emerald-950/20",
  warning: "border-[#C5A67C]/35 bg-[#2A1F0D]/35",
  error: "border-red-400/40 bg-red-950/20",
  protection: "border-red-400/45 bg-red-950/25",
};

export function ProtectionModal({ notice, onClose }: Props) {
  const styles = severityStyles[notice.severity];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-labelledby={`protection-title-${notice.id}`}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full max-w-lg rounded-2xl border ${severityFrame[notice.severity]} p-6 shadow-2xl ${styles.glow}`}>
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
          <span className={`h-px flex-1 bg-gradient-to-r ${severityDivider[notice.severity]} to-transparent`} />
        </div>

        <h2 id={`protection-title-${notice.id}`} className={`text-2xl font-semibold tracking-tight ${styles.title}`}>
          {notice.title}
        </h2>
        {notice.subtitle && <p className={`mt-1 text-sm font-medium ${styles.message}`}>{notice.subtitle}</p>}
        <p className={`mt-4 text-sm leading-6 ${styles.message}`}>{notice.message}</p>

        {notice.technicalDetail && (
          <div className={`mt-5 rounded-xl border ${severityDetailBox[notice.severity]} p-3`}>
            <div className={`mb-1 text-[10px] uppercase tracking-[0.22em] ${severityDetailLabel[notice.severity]}`}>Technical detail</div>
            <code className={`break-words text-xs ${styles.detail}`}>{notice.technicalDetail}</code>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          {notice.actionHref && notice.actionLabel && (
            <a
              href={notice.actionHref}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${severityAction[notice.severity]}`}
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
