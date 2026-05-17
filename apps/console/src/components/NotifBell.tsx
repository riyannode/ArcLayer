'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useNotifications } from '@/hooks/useNotifications';
import type { Notification } from '@/lib/notifications';

function NotifIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NotifItem({
  notif,
  onRead,
  onClose,
}: {
  notif: Notification;
  onRead: (id: string) => void;
  onClose: () => void;
}) {
  const icon = notif.type === 'payment_received' ? '💰' : '📋';
  return (
    <Link
      href={`/job/${notif.jobId}`}
      onClick={() => {
        onRead(notif.id);
        onClose();
      }}
      className="flex items-start gap-3 px-4 py-3 transition-colors duration-200"
      style={{
        background: notif.read ? 'transparent' : 'rgba(197, 166, 124, 0.06)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(197, 166, 124, 0.1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = notif.read ? 'transparent' : 'rgba(197, 166, 124, 0.06)';
      }}
    >
      <span className="mt-0.5 text-base">{icon}</span>
      <div className="min-w-0 flex-1">
        <p
          className="truncate font-mono text-[11px]"
          style={{ color: notif.read ? '#7A7A7A' : '#EAE4D8' }}
        >
          {notif.message}
        </p>
        <p className="mt-0.5 font-mono text-[9px] text-white/80">{timeAgo(notif.timestamp)}</p>
      </div>
      {!notif.read && (
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ background: '#C5A67C' }}
        />
      )}
    </Link>
  );
}

export default function NotifBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative flex items-center justify-center p-2 transition-colors duration-200"
        style={{ color: unreadCount > 0 ? '#C5A67C' : 'rgba(255, 255, 255, 0.4)' }}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <NotifIcon size={18} />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[9px] font-bold text-black"
            style={{ background: '#C5A67C' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-[320px] overflow-hidden rounded-sm shadow-2xl"
          style={{
            background: 'rgba(10, 10, 10, 0.98)',
            border: '1px solid rgba(197, 166, 124, 0.2)',
            backdropFilter: 'blur(20px)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}
          >
            <span className="font-mono text-[10px] tracking-[0.18em] text-[#C5A67C]">
              NOTIFICATIONS
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="font-mono text-[9px] tracking-[0.14em] text-white/80 transition-colors hover:text-[#C5A67C]"
              >
                MARK ALL READ
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[360px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="font-mono text-[11px] text-white/80">No notifications yet</p>
                <p className="mt-1 font-mono text-[9px] text-white/80">
                  You&apos;ll be notified when jobs are assigned or payments received
                </p>
              </div>
            ) : (
              notifications.map((notif) => (
                <NotifItem
                  key={notif.id}
                  notif={notif}
                  onRead={markAsRead}
                  onClose={() => setOpen(false)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
