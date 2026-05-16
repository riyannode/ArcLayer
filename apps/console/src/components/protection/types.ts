/**
 * Protection notification system — public types.
 *
 * Three surfaces for three signal levels:
 *   - modal  → critical security/protection events (centered, blocking)
 *   - toast  → action feedback (stacks, auto-dismiss)
 *   - inline → contextual hints inside forms/cards (rendered in-place)
 *
 * Severity is decoupled from surface so we can tint without forcing
 * a specific render style.
 */

export type ProtectionSeverity =
  | "info"
  | "success"
  | "warning"
  | "error"
  | "protection";

export type ProtectionSurface = "modal" | "toast" | "inline";

export type ProtectionNotice = {
  id: string;
  severity: ProtectionSeverity;
  surface: ProtectionSurface;
  title: string;
  subtitle?: string;
  message: string;
  technicalDetail?: string;
  actionLabel?: string;
  actionHref?: string;
  /**
   * Auto-close timeout in ms. Set 0 / undefined to keep open until user
   * dismisses (use for hard-stop errors).
   */
  autoCloseMs?: number;
  /**
   * Dedupe identical notices. Same key fired within DEDUPE_COOLDOWN_MS
   * is silently dropped (prevents replay loops from spamming the UI).
   */
  dedupeKey?: string;
};

export type ProtectionInput = Omit<ProtectionNotice, "id">;

export type ProtectionContextValue = {
  notify: (notice: ProtectionInput) => string | null;
  dismiss: (id: string) => void;
  clearAll: () => void;
  modal: ProtectionNotice | null;
  toasts: ProtectionNotice[];
};
