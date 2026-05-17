"use client";

import type { ProtectionSeverity } from "./types";

type Props = {
  severity?: ProtectionSeverity;
  title?: string;
  message: string;
  technicalDetail?: string;
  className?: string;
};

const tone: Record<ProtectionSeverity, { wrap: string; tag: string; tagText: string; messageText: string; detailText: string }> = {
  info: { wrap: "border-sky-400/20 bg-sky-400/[0.04]", tag: "border-sky-400/25 bg-sky-400/10", tagText: "text-sky-200", messageText: "text-sky-100/80", detailText: "text-sky-100/75" },
  success: { wrap: "border-emerald-400/30 bg-emerald-400/[0.06]", tag: "border-emerald-400/35 bg-emerald-400/10", tagText: "text-emerald-300", messageText: "text-emerald-100/85", detailText: "text-emerald-100/75" },
  warning: { wrap: "border-[#C5A67C]/25 bg-[#C5A67C]/[0.04]", tag: "border-[#C5A67C]/30 bg-[#C5A67C]/10", tagText: "text-[#F2D8A8]", messageText: "text-[#F7DCA8]/80", detailText: "text-[#F7DCA8]/75" },
  error: { wrap: "border-red-400/30 bg-red-400/[0.06]", tag: "border-red-400/35 bg-red-400/10", tagText: "text-red-300", messageText: "text-red-100/85", detailText: "text-red-100/75" },
  protection: { wrap: "border-red-400/30 bg-red-400/[0.06]", tag: "border-red-400/35 bg-red-400/10", tagText: "text-red-300", messageText: "text-red-100/85", detailText: "text-red-100/75" },
};

const labelDefault: Record<ProtectionSeverity, string> = {
  info: "Notice",
  success: "Success",
  warning: "Heads up",
  error: "Action blocked",
  protection: "x402 rejected",
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
          <p className={`text-xs leading-5 ${t.messageText}`}>{message}</p>
          {technicalDetail && (
            <code className={`mt-1 block text-[10px] ${t.detailText}`}>{technicalDetail}</code>
          )}
        </div>
      </div>
    </div>
  );
}
