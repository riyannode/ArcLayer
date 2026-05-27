'use client';

import { useEffect } from 'react';

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ArcLayer route error]', error);
    }
  }, [error]);

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-12 text-[#EAE4D8]">
      <div className="mx-auto max-w-3xl rounded-sm border border-[#C5A67C]/20 bg-[#0A0A0A]/95 p-6 shadow-2xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#C5A67C]">
          ArcLayer Runtime Guard
        </div>

        <h1 className="mt-3 text-2xl font-black uppercase tracking-[0.14em] text-[#F5F0E5]">
          Runtime panel degraded
        </h1>

        <p className="mt-3 text-sm leading-6 text-[#EAE4D8]/70">
          This page hit a client/runtime exception, but the application shell is still available.
          Retry the panel or return to another ArcLayer route.
        </p>

        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-[#EAE4D8]/45">
            digest: {error.digest}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15"
          >
            Retry panel
          </button>

          <a
            href="/"
            className="rounded-sm border border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/70 hover:border-[#C5A67C]/35 hover:text-[#C5A67C]"
          >
            Back home
          </a>
        </div>
      </div>
    </main>
  );
}
