"use client";

import type { ProtectionSeverity } from "./types";

type Props = {
  severity?: ProtectionSeverity;
  title?: string;
  message: string;
  technicalDetail?: string;
  className?: string;
};

const tone: Record<ProtectionSeverity, { wrap: string; tag: string; tagText: string }> = {
  info: { wrap: "border-sky-400/20 bg-sky-400/[0.04]", tag: "border-sky-400/25 bg-sky-400/10", tagText: "text-sky-200" },
  success: { wrap: "border-emerald-400/20 bg-emerald-400/[0.04]", tag: "border-emerald-400/25 bg-emerald-400/10", tagText: "text-emerald-200" },
  warning: { wrap: "border-[#C5A67C]/25 bg-[#C5A67C]/[0.04]", tag: "border-[#C5A67C]/30 bg-[#C5A67C]/10", tagText: "text-[#F2D8A8]" },
  error: { wrap: "border-red-400/25 bg-red-400/[0.04]", tag: "border-red-400/25 bg-red-400/10", tagText: "text-red-200" },
  protection: { wrap: "border-[#C5A67C]/30 bg-[#C5A67C]/[0.06]", tag: "border-[#C5A67C]/35 bg-[#C5A67C]/12", tagText: "text-[#F7DCA8]" },
};

const labelDefault: Record<ProtectionSeverity, string> = {
  info: "Notice",
  success: "OK",
  warning: "Heads up",
  error: "Action blocked",
  protection: "x402 protection",
};

/**
 * Inline contextual notice — render inside forms/cards where the issue
 * is local (e.g. "Worker equals client", "Connect wallet to register").
 *
 * Use this instead of a toast when the user's eyes are already on the
 * relevant field. Use a modal only for cross-cutting protection events.
 */
export function InlineProtectionNotice({
  severity = "warning",
  title,
  message,
  technicalDetail,
  className = "",
}: Props) {
  const t = tone[severity];
  const label = title ?? labelDefault[severity];

  return (
    <div className={`rounded-lg border ${t.wrap} px-3 py-2 ${className}`} role="status">
      <div className="flex items-start gap-2">
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] ${t.tag} ${t.tagText}`}>
          {label}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs leading-5 text-white/75">{message}</p>
          {technicalDetail && (
            <code className="mt-1 block text-[10px] text-white/80">{technicalDetail}</code>
          )}
        </div>
      </div>
    </div>
  );
}
