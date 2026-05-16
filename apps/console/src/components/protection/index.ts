/**
 * Protection notification system — public barrel.
 *
 * Usage:
 *   import { useProtectionNotice, NOTICE_REPLAY_REJECTED } from "@/components/protection";
 *   notify(NOTICE_REPLAY_REJECTED);
 *
 * Three surfaces:
 *   - modal  → critical security/protection events
 *   - toast  → action feedback (max 3 stacked)
 *   - inline → contextual hints inside forms/cards
 */

export { ProtectionNoticeProvider, useProtectionNotice } from "./ProtectionNoticeProvider";
export { ProtectionModal } from "./ProtectionModal";
export { ProtectionToast } from "./ProtectionToast";
export { InlineProtectionNotice } from "./InlineProtectionNotice";
export type {
  ProtectionNotice,
  ProtectionInput,
  ProtectionSeverity,
  ProtectionSurface,
  ProtectionContextValue,
} from "./types";
export * from "./notices";
