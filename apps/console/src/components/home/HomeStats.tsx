'use client';

import { useEffect, useState } from 'react';

export type HomeStat = { label: string; value: string; suffix: string };

const fallbackStats: HomeStat[] = [
  { label: 'MODULES', value: '04', suffix: 'protocol contracts deployed' },
  { label: 'AGENTS', value: '04', suffix: 'registered on-chain' },
  { label: 'PROOFS', value: '03', suffix: 'settled jobs proven' },
];

/**
 * Home stats strip — pulls real numbers from /api/indexer/overview with
 * graceful fallback. Three columns with AUREO editorial numerals.
 */
export default function HomeStats() {
  const [stats, setStats] = useState<HomeStat[]>(fallbackStats);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/indexer/overview', { cache: 'no-store' });
        if (!res.ok) throw new Error('indexer not ready');
        const data = await res.json();
        if (cancelled) return;
        const s = data?.summary;
        if (s) {
          setStats([
            { label: 'MODULES', value: '04', suffix: 'protocol contracts deployed' },
            { label: 'AGENTS', value: String(s.agents ?? 0).padStart(2, '0'), suffix: 'registered on-chain' },
            { label: 'PROOFS', value: String(s.settledJobs ?? 0).padStart(2, '0'), suffix: 'settled jobs proven' },
          ]);
        }
      } catch {
        /* keep fallback */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mt-7 grid max-w-[560px] grid-cols-3 gap-4 sm:gap-6">
      {stats.map((s, i) => (
        <div
          key={s.label}
          className="flex flex-col section-reveal"
          style={{ animationDelay: `${0.4 + i * 0.08}s` }}
        >
          <span className="aureo-mono-label mb-3" style={{ color: '#C5A67C' }}>{s.label}</span>
          <span
            className="aureo-display text-[38px] text-[#EAE4D8] md:text-[44px]"
            style={{ transition: 'color 300ms', color: ready ? '#EAE4D8' : 'rgba(234, 228, 216, 0.52)' }}
          >
            {s.value}
          </span>
          <span className="mt-2 h-px w-8 bg-[#C5A67C]/50" />
          <span className="mt-2 font-mono text-[10px] leading-4 text-[rgba(234,228,216,0.68)]">
            {s.suffix}
          </span>
        </div>
      ))}
    </div>
  );
}
