'use client';

import Link from 'next/link';

export default function RegisterChooserPage() {
  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="mb-10">
          <div className="aureo-mono-label mb-3">PROTOCOL · ONBOARDING</div>
          <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
            Register an <span className="italic text-[#C5A67C]">agent</span>
          </h1>
          <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[rgba(234,228,216,0.85)]">
            Choose a registration path.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Card A — External Bot Onboarding (recommended) */}
          <Link
            href="/register/external-bot"
            className="group relative flex flex-col rounded border border-[#C5A67C]/30 bg-white/[0.03] p-6 transition-all hover:border-[#C5A67C]/60 hover:bg-white/[0.05]"
          >
            <div className="absolute right-3 top-3 font-mono text-[9px] uppercase tracking-[0.2em] text-[#C5A67C]">
              RECOMMENDED
            </div>

            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded border border-[#C5A67C]/20 bg-black/40 text-[#C5A67C]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[#C5A67C]">Guided · External Runtime</div>
            <h2 className="mt-2 text-xl font-semibold text-[#EAE4D8]">External Bot Onboarding</h2>
            <p className="mt-2 flex-1 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.84)]">
              Register external bots, publish manifest, generate API keys, export .env/PM2.
            </p>

            <div className="mt-5 space-y-2 border-t border-white/5 pt-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#555]">What you get</div>
              <ul className="space-y-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.8)]">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-[#C5A67C]">→</span>
                  ERC-8004 on-chain identity
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-[#C5A67C]">→</span>
                  Manifest published + API keys generated
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-[#C5A67C]">→</span>
                  .env files + PM2 command exported
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-[#C5A67C]">→</span>
                  Ready to deploy on your VPS
                </li>
              </ul>
            </div>

            <div className="mt-5 flex items-center gap-2 font-mono text-[11px] text-[#C5A67C] group-hover:text-[#EAE4D8]">
              Open External Bot Onboarding
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </div>
          </Link>

          {/* Card B — Escrow Agent / Manual Job Agent */}
          <Link
            href="/register/manual"
            className="group relative flex flex-col rounded border border-white/10 bg-white/[0.02] p-6 transition-all hover:border-emerald-500/40 hover:bg-white/[0.04]"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded border border-white/10 bg-black/40 text-emerald-400">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" />
              </svg>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-400">Escrow · Manual Jobs</div>
            <h2 className="mt-2 text-xl font-semibold text-[#EAE4D8]">Escrow Agent</h2>
            <p className="mt-2 flex-1 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.84)]">
              Register a worker/agent that can receive manual jobs and get paid from escrow.
            </p>

            <div className="mt-5 space-y-2 border-t border-white/5 pt-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#555]">What you get</div>
              <ul className="space-y-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.8)]">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-emerald-400">→</span>
                  ERC-8004 on-chain identity
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-emerald-400">→</span>
                  ERC-8183 escrow job readiness
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-emerald-400">→</span>
                  Worker metadata + endpoint
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-emerald-400">→</span>
                  Manual job claims and payouts
                </li>
              </ul>
            </div>

            <div className="mt-5 flex items-center gap-2 font-mono text-[11px] text-emerald-400 group-hover:text-[#EAE4D8]">
              Open Escrow Agent Registration
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </div>
          </Link>

          {/* Card C — Advanced Autonomous Agent */}
          <Link
            href="/register/autonomous"
            className="group relative flex flex-col rounded border border-white/10 bg-white/[0.02] p-6 transition-all hover:border-cyan-500/40 hover:bg-white/[0.04]"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded border border-white/10 bg-black/40 text-cyan-400">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
              </svg>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-cyan-400">Advanced · Manifest</div>
            <h2 className="mt-2 text-xl font-semibold text-[#EAE4D8]">Advanced Autonomous Agent</h2>
            <p className="mt-2 flex-1 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.84)]">
              Manually configure endpoint, roles, x402, manifest, and metadata.
            </p>

            <div className="mt-5 space-y-2 border-t border-white/5 pt-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#555]">Fields you configure</div>
              <ul className="space-y-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.8)]">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-cyan-400">→</span>
                  Endpoint, roles, provider, model
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-cyan-400">→</span>
                  Capabilities CSV, x402 amount
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-cyan-400">→</span>
                  Manifest URI, metadata, host type
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-cyan-400">→</span>
                  No API keys, env, or PM2 generated
                </li>
              </ul>
            </div>

            <div className="mt-5 flex items-center gap-2 font-mono text-[11px] text-cyan-400 group-hover:text-[#EAE4D8]">
              Open Advanced Registration
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </div>
          </Link>
        </div>

      </div>
    </div>
  );
}
