"use client";

import { useEffect, useState } from "react";
import type { ProtectionNotice } from "./types";

type Props = {
  toasts: ProtectionNotice[];
  onDismiss: (id: string) => void;
};

const severityColor: Record<ProtectionNotice["severity"], string> = {
  info: "border-sky-400/25 bg-sky-400/[0.06]",
  success: "border-emerald-400/40 bg-emerald-400/[0.08]",
  warning: "border-[#C5A67C]/25 bg-[#C5A67C]/[0.06]",
  error: "border-red-400/40 bg-red-400/[0.08]",
  protection: "border-red-400/40 bg-red-400/[0.08]",
};

const severityIcon: Record<ProtectionNotice["severity"], string> = {
  info: "ℹ️",
  success: "✓",
  warning: "⚠",
  error: "✕",
  protection: "🛡",
};

const severityTitleColor: Record<ProtectionNotice["severity"], string> = {
  info: "text-sky-200",
  success: "text-emerald-300",
  warning: "text-[#F2D8A8]",
  error: "text-red-300",
  protection: "text-red-300",
};

const severityMsgColor: Record<ProtectionNotice["severity"], string> = {
  info: "text-sky-100/80",
  success: "text-emerald-100/85",
  warning: "text-[#F7DCA8]/80",
  error: "text-red-100/85",
  protection: "text-red-100/85",
};

function ToastItem({ notice, onDismiss }: { notice: ProtectionNotice; onDismiss: () => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (notice.autoCloseMs && notice.autoCloseMs > 0) {
      const t = setTimeout(() => {
        setExiting(true);
        setTimeout(onDismiss, 300);
      }, notice.autoCloseMs);
      return () => clearTimeout(t);
    }
  }, [notice.autoCloseMs, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-4 shadow-lg backdrop-blur-md transition-all duration-300 ${
        exiting ? "translate-x-4 opacity-0" : "translate-x-0 opacity-100"
      } ${severityColor[notice.severity]}`}
    >
      <span className="mt-0.5 text-base leading-none">{severityIcon[notice.severity]}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${severityTitleColor[notice.severity]}`}>{notice.title}</p>
        <p className={`mt-0.5 text-xs line-clamp-2 ${severityMsgColor[notice.severity]}`}>{notice.message}</p>
        {notice.technicalDetail && (
          <code className="mt-1 block text-[10px] text-white/80 truncate">{notice.technicalDetail}</code>
        )}
      </div>
      <button
        type="button"
        onClick={() => { setExiting(true); setTimeout(onDismiss, 300); }}
        className="shrink-0 text-white/80 hover:text-white/80 transition text-xs"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

export function ProtectionToast({ toasts, onDismiss }: Props) {
  // Max 3 visible
  const visible = toasts.slice(-3);

  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[110] flex flex-col-reverse gap-2 pointer-events-none">
      {visible.map((t) => (
        <ToastItem key={t.id} notice={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}
