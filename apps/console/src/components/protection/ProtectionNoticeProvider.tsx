"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ProtectionModal } from "./ProtectionModal";
import { ProtectionToast } from "./ProtectionToast";
import type { ProtectionContextValue, ProtectionInput, ProtectionNotice } from "./types";

const ProtectionNoticeContext = createContext<ProtectionContextValue | null>(null);
const DEDUPE_COOLDOWN_MS = 5_000;

function createId() {
  return `protection_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultAutoClose(notice: ProtectionInput) {
  if (notice.autoCloseMs !== undefined) return notice.autoCloseMs;
  if (notice.surface === "modal" && (notice.severity === "success" || notice.severity === "protection")) return 5_000;
  if (notice.surface === "toast" && notice.severity !== "error") return 4_500;
  return undefined;
}

export function ProtectionNoticeProvider({ children }: { children: React.ReactNode }) {
  const [modal, setModal] = useState<ProtectionNotice | null>(null);
  const [toasts, setToasts] = useState<ProtectionNotice[]>([]);
  const dedupeRef = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setModal((current) => (current?.id === id ? null : current));
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setModal(null);
    setToasts([]);
  }, []);

  const notify = useCallback((input: ProtectionInput) => {
    const key = input.dedupeKey ?? `${input.surface}:${input.severity}:${input.title}:${input.technicalDetail ?? input.message}`;
    const now = Date.now();
    const lastShown = dedupeRef.current.get(key) ?? 0;
    if (now - lastShown < DEDUPE_COOLDOWN_MS) return null;
    dedupeRef.current.set(key, now);

    const notice: ProtectionNotice = {
      ...input,
      id: createId(),
      autoCloseMs: defaultAutoClose(input),
      dedupeKey: key,
    };

    if (notice.surface === "modal") {
      setModal(notice);
    } else if (notice.surface === "toast") {
      setToasts((current) => [...current.filter((t) => t.dedupeKey !== key), notice].slice(-6));
    }

    return notice.id;
  }, []);

  useEffect(() => {
    if (!modal?.autoCloseMs || modal.autoCloseMs <= 0) return;
    const t = setTimeout(() => dismiss(modal.id), modal.autoCloseMs);
    return () => clearTimeout(t);
  }, [modal, dismiss]);

  const value = useMemo<ProtectionContextValue>(() => ({ notify, dismiss, clearAll, modal, toasts }), [notify, dismiss, clearAll, modal, toasts]);

  return (
    <ProtectionNoticeContext.Provider value={value}>
      {children}
      {modal && <ProtectionModal notice={modal} onClose={() => dismiss(modal.id)} />}
      <ProtectionToast toasts={toasts} onDismiss={dismiss} />
    </ProtectionNoticeContext.Provider>
  );
}

export function useProtectionNotice() {
  const ctx = useContext(ProtectionNoticeContext);
  if (!ctx) throw new Error("useProtectionNotice must be used inside ProtectionNoticeProvider");
  return ctx;
}
