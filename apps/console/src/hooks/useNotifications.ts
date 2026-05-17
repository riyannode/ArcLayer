'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useCircleWallet } from './useCircleWallet';
import {
  Notification,
  getNotifications,
  addNotification,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
} from '@/lib/notifications';
import { INDEXER_BASE_URL, IndexedJob } from '@/lib/indexer';

const POLL_INTERVAL_MS = 12_000;

/**
 * Hook that polls the indexer and detects:
 * 1. New jobs where connected wallet is the worker (job_assigned)
 * 2. Jobs that moved to Settled where connected wallet is the worker (payment_received)
 *
 * Stores notifications in localStorage per wallet address.
 */
export function useNotifications() {
  const { authenticated, address } = useCircleWallet();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Track previously seen job states to detect transitions
  const prevJobsRef = useRef<Map<string, number>>(new Map());
  const initializedRef = useRef(false);

  const refreshState = useCallback(() => {
    if (!address) return;
    setNotifications(getNotifications(address));
    setUnreadCount(getUnreadCount(address));
  }, [address]);

  const handleMarkAsRead = useCallback(
    (notifId: string) => {
      if (!address) return;
      const updated = markAsRead(address, notifId);
      setNotifications(updated);
      setUnreadCount(updated.filter((n) => !n.read).length);
    },
    [address]
  );

  const handleMarkAllAsRead = useCallback(() => {
    if (!address) return;
    const updated = markAllAsRead(address);
    setNotifications(updated);
    setUnreadCount(0);
  }, [address]);

  // Poll indexer for job changes
  useEffect(() => {
    if (!authenticated || !address) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    // Load existing notifications on mount
    refreshState();

    const checkJobs = async () => {
      try {
        const res = await fetch(`${INDEXER_BASE_URL}/jobs`, { cache: 'no-store' });
        if (!res.ok) return;
        const jobs: IndexedJob[] = await res.json();

        const walletLower = address.toLowerCase();
        const myWorkerJobs = jobs.filter((j) => j.worker.toLowerCase() === walletLower);

        const prevMap = prevJobsRef.current;
        let changed = false;

        for (const job of myWorkerJobs) {
          const prevStatus = prevMap.get(job.id);
          const currentStatus = job.status;

          // Skip first load — don't spam old jobs as new notifications
          if (!initializedRef.current) {
            prevMap.set(job.id, currentStatus);
            continue;
          }

          // New job assigned (wasn't in prev map at all)
          if (prevStatus === undefined && currentStatus >= 0) {
            addNotification(address, {
              type: 'job_assigned',
              jobId: job.id,
              message: `New job #${job.id} assigned to you`,
            });
            changed = true;
          }

          // Job settled (status moved to 5)
          if (prevStatus !== undefined && prevStatus < 5 && currentStatus === 5) {
            const amount = job.fundedAmount || job.budget || '0';
            const usdcFormatted = (Number(amount) / 1e6).toFixed(2);
            addNotification(address, {
              type: 'payment_received',
              jobId: job.id,
              message: `Payment received: ${usdcFormatted} USDC for job #${job.id}`,
              amount: usdcFormatted,
            });
            changed = true;
          }

          prevMap.set(job.id, currentStatus);
        }

        initializedRef.current = true;

        if (changed) {
          refreshState();
        }
      } catch {
        // Indexer unreachable — silent fail, retry next interval
      }
    };

    checkJobs();
    const interval = setInterval(checkJobs, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [authenticated, address, refreshState]);

  return {
    notifications,
    unreadCount,
    markAsRead: handleMarkAsRead,
    markAllAsRead: handleMarkAllAsRead,
  };
}
