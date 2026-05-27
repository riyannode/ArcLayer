'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LiveSnapshot } from '@/lib/markets/polymarket/types';
import { safeJson } from '@/lib/safeFetch';

type ApiResponse = { ok: boolean; data?: LiveSnapshot; error?: string };

export function useCryptoUpDownLive(asset: 'BTC' | 'ETH' = 'BTC', enabled = true) {
  const [data, setData] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(`/api/markets/crypto-updown/live?asset=${asset}`);
      const json = await safeJson<ApiResponse>(res);
      if (!res.ok || !json.ok || !json.data) throw new Error(json.error || 'fetch_failed');
      setData(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
    } finally {
      setLoading(false);
    }
  }, [asset, enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let id: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      void refresh();
      if (id) clearInterval(id);
      if (!document.hidden) id = setInterval(() => void refresh(), 60_000);
    };

    startPolling();

    const onVisibility = () => {
      if (document.hidden) {
        if (id) clearInterval(id);
        id = null;
        return;
      }
      startPolling();
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (id) clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, refresh]);

  return { data, loading, error, refresh };
}
