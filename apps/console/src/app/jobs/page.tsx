'use client';

import Link from 'next/link';

export default function JobsChooserPage() {
  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="mb-10">
          <div className="aureo-mono-label mb-3">PROTOCOL · JOB ROUTING</div>
          <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
            Create a <span className="italic text-[#C5A67C]">job</span>
          </h1>
          <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[rgba(234,228,216,0.85)] invisible">
            Choose manual escrow or A2A payment flow.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Link
            href="/jobs/manual"
            className="group relative flex flex-col rounded border border-white/10 bg-white/[0.02] p-6 transition-all hover:border-[#C5A67C]/40 hover:bg-white/[0.04]"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded border border-white/10 bg-black/40 text-[#C5A67C]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7.5h16" />
                <path d="M7 4.5h10l2 3v12H5v-12l2-3Z" />
                <path d="M8 12h8" />
                <path d="M8 16h5" />
              </svg>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[#C5A67C]">Manual Job</div>
            <h2 className="mt-2 text-xl font-semibold text-[#EAE4D8]">Escrow Work Order</h2>
            <p className="mt-2 flex-1 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.84)] invisible">
              Create a funded escrow job.
            </p>

            <div className="mt-5 space-y-2 border-t border-white/5 pt-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#555]">Route</div>
              <ul className="space-y-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.8)]">
                <li className="flex items-start gap-2"><span className="mt-0.5 text-[#C5A67C]">→</span>Select agent + worker</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-[#C5A67C]">→</span>Create and fund escrow</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-[#C5A67C]">→</span>Approve delivery + mint WorkProof</li>
              </ul>
            </div>

            <div className="mt-5 flex items-center gap-2 font-mono text-[11px] text-[#C5A67C] group-hover:text-[#EAE4D8]">
              Open Manual Job
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </div>
          </Link>

          <Link
            href="/a2a"
            className="group relative flex flex-col rounded border border-white/10 bg-white/[0.02] p-6 transition-all hover:border-cyan-500/40 hover:bg-white/[0.04]"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded border border-white/10 bg-black/40 text-cyan-400">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 8a3 3 0 1 0 0 6" />
                <path d="M17 10a3 3 0 1 1 0 6" />
                <path d="M8.5 11h7" />
                <path d="M8.5 13h7" />
                <path d="M12 5v3" />
                <path d="M12 16v3" />
              </svg>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-cyan-400">A2A Job</div>
            <h2 className="mt-2 text-xl font-semibold text-[#EAE4D8]">Agent-to-Agent Call</h2>
            <p className="mt-2 flex-1 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.84)] invisible">
              Discover and pay autonomous agents.
            </p>

            <div className="mt-5 space-y-2 border-t border-white/5 pt-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#555]">Route</div>
              <ul className="space-y-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.8)]">
                <li className="flex items-start gap-2"><span className="mt-0.5 text-cyan-400">→</span>Browse A2A agents</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-cyan-400">→</span>Pay per request via x402</li>
                <li className="flex items-start gap-2"><span className="mt-0.5 text-cyan-400">→</span>Execute without escrow workflow</li>
              </ul>
            </div>

            <div className="mt-5 flex items-center gap-2 font-mono text-[11px] text-cyan-400 group-hover:text-[#EAE4D8]">
              Open A2A Network
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
