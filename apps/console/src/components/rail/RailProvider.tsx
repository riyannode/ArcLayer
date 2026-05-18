'use client';

/**
 * Rail context — single source of truth for the user's chosen x402 rail.
 *
 * Selected once per wallet (server-enforced via /api/user/rail), cached in
 * localStorage for instant boot. All x402 calls must include `X-ARC-RAIL: <rail>`
 * header so the server can reject any mismatch.
 *
 * Rails:
 *   native  = Arc Native EIP-3009 (self-hosted relayer)
 *   gateway = Circle Gateway batched EIP-3009
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useArcWallet } from '@/hooks/useArcWallet';

export type Rail = 'native' | 'gateway';

export interface RailState {
  /** Active rail. null when wallet is connected but hasn't picked one yet. */
  rail: Rail | null;
  /** True once the rail has been read from server (or confirmed missing). */
  hydrated: boolean;
  /** True if a /api/user/rail request is in flight. */
  loading: boolean;
  /** Last error from the rail API, if any. */
  error: string | null;
  /** Lock a rail for the current wallet. Returns the active rail (locked or existing). */
  selectRail: (next: Rail) => Promise<Rail>;
}

const RailContext = createContext<RailState | null>(null);

const STORAGE_KEY_PREFIX = 'arclayer.rail.';

function storageKey(address: string): string {
  return `${STORAGE_KEY_PREFIX}${address.toLowerCase()}`;
}

function readCachedRail(address: string): Rail | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(address));
    if (raw === 'native' || raw === 'gateway') return raw;
  } catch {
    /* ignore */
  }
  return null;
}

function writeCachedRail(address: string, rail: Rail | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (rail) window.localStorage.setItem(storageKey(address), rail);
    else window.localStorage.removeItem(storageKey(address));
  } catch {
    /* ignore */
  }
}

export function RailProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useArcWallet();

  const [rail, setRail] = useState<Rail | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when wallet changes / disconnects, then hydrate from cache + server.
  useEffect(() => {
    if (!isConnected || !address) {
      setRail(null);
      setHydrated(false);
      setError(null);
      return;
    }

    // Optimistic read from localStorage so UI renders immediately.
    const cached = readCachedRail(address);
    if (cached) setRail(cached);

    let cancelled = false;
    setLoading(true);
    fetch(`/api/user/rail?wallet=${address}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const serverRail = data?.rail === 'native' || data?.rail === 'gateway' ? (data.rail as Rail) : null;
        setRail(serverRail);
        writeCachedRail(address, serverRail);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'rail_fetch_failed');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  const selectRail = useCallback(
    async (next: Rail): Promise<Rail> => {
      if (!isConnected || !address) {
        throw new Error('wallet_not_connected');
      }

      setLoading(true);
      setError(null);
      try {
        const resp = await fetch('/api/user/rail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: address, rail: next }),
        });
        const data = await resp.json();

        if (!resp.ok) {
          // Server already locked to a different rail — sync state to server's truth.
          if (data?.error === 'rail_locked' && (data?.rail === 'native' || data?.rail === 'gateway')) {
            const locked = data.rail as Rail;
            setRail(locked);
            writeCachedRail(address, locked);
            setError(`rail_locked:${locked}`);
            return locked;
          }
          throw new Error(data?.message || data?.error || 'rail_select_failed');
        }

        const finalRail = (data.rail === 'native' || data.rail === 'gateway') ? data.rail as Rail : next;
        setRail(finalRail);
        writeCachedRail(address, finalRail);
        return finalRail;
      } finally {
        setLoading(false);
      }
    },
    [address, isConnected],
  );

  const value = useMemo<RailState>(
    () => ({ rail, hydrated, loading, error, selectRail }),
    [rail, hydrated, loading, error, selectRail],
  );

  return <RailContext.Provider value={value}>{children}</RailContext.Provider>;
}

export function useRail(): RailState {
  const ctx = useContext(RailContext);
  if (!ctx) {
    throw new Error('useRail must be used inside <RailProvider>');
  }
  return ctx;
}

/** Helper: build fetch headers that include rail + wallet when active. */
export function railHeaders(rail: Rail | null, wallet?: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (rail) headers['X-ARC-RAIL'] = rail;
  if (wallet) headers['X-ARC-WALLET'] = wallet;
  return headers;
}
