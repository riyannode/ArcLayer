'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LiveSnapshot } from '@/lib/markets/polymarket/types';

type ApiResponse = { ok: boolean; data?: LiveSnapshot; error?: string };

export function useCryptoUpDownLive(asset: 'BTC' | 'ETH' = 'BTC') {
  const [data, setData] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/markets/crypto-updown/live?asset=${asset}`, { cache: 'no-store' });
      const json = await res.json() as ApiResponse;
      if (!res.ok || !json.ok || !json.data) throw new Error(json.error || 'fetch_failed');
      setData(json.data); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'network_error'); }
    finally { setLoading(false); }
  }, [asset]);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const loop = () => {
      refresh();
      if (id) clearInterval(id);
      if (!document.hidden) id = setInterval(refresh, 5000);
    };
    loop();
    const onVisibility = () => loop();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { if (id) clearInterval(id); document.removeEventListener('visibilitychange', onVisibility); };
  }, [refresh]);

  return { data, loading, error, refresh };
}
