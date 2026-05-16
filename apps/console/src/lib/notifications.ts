/**
 * Notification store — localStorage-backed per-wallet notification system.
 * Tracks job assignments and USDC payment receipts for the connected wallet.
 */

export type NotifType = 'job_assigned' | 'payment_received';

export interface Notification {
  id: string;
  type: NotifType;
  jobId: string;
  message: string;
  timestamp: number;
  read: boolean;
  /** Optional USDC amount for payment notifs */
  amount?: string;
}

const STORAGE_KEY_PREFIX = 'arclayer_notifs_';

function getStorageKey(wallet: string): string {
  return `${STORAGE_KEY_PREFIX}${wallet.toLowerCase()}`;
}

export function getNotifications(wallet: string): Notification[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getStorageKey(wallet));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveNotifications(wallet: string, notifs: Notification[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Keep max 50 notifications per wallet
    const trimmed = notifs.slice(0, 50);
    localStorage.setItem(getStorageKey(wallet), JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

export function addNotification(wallet: string, notif: Omit<Notification, 'id' | 'timestamp' | 'read'>): Notification[] {
  const existing = getNotifications(wallet);
  // Deduplicate by jobId + type
  if (existing.some((n) => n.jobId === notif.jobId && n.type === notif.type)) {
    return existing;
  }
  const newNotif: Notification = {
    ...notif,
    id: `${notif.type}_${notif.jobId}_${Date.now()}`,
    timestamp: Date.now(),
    read: false,
  };
  const updated = [newNotif, ...existing];
  saveNotifications(wallet, updated);
  return updated;
}

export function markAsRead(wallet: string, notifId: string): Notification[] {
  const notifs = getNotifications(wallet);
  const updated = notifs.map((n) => (n.id === notifId ? { ...n, read: true } : n));
  saveNotifications(wallet, updated);
  return updated;
}

export function markAllAsRead(wallet: string): Notification[] {
  const notifs = getNotifications(wallet);
  const updated = notifs.map((n) => ({ ...n, read: true }));
  saveNotifications(wallet, updated);
  return updated;
}

export function getUnreadCount(wallet: string): number {
  return getNotifications(wallet).filter((n) => !n.read).length;
}
