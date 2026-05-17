'use client';

type Module = { t: string; s: string };

const modules: Module[] = [
  { t: 'x402 Facilitator', s: 'HTTP 402 payment gate' },
  { t: 'Settlement Vault', s: 'USDC escrow per job' },
  { t: 'Agent Registry', s: 'On-chain agent identity' },
  { t: 'WorkProof', s: 'Verifiable job NFTs' },
];

/**
 * Protocol primitives — compact educational section under the hero.
 * Step-by-step flow lives in HomeWhoIsThisFor (per-path); this section
 * only surfaces the four on-chain primitives so users see what's deployed.
 */
export default function HomeProtocolSection() {
  return (
    <section
      id="protocol"
      className="relative z-20 px-6 py-14 md:px-12 md:pl-[80px] md:py-16 lg:px-24"
    >
      <div
        className="pointer-events-none absolute left-[56px] top-0 h-px w-[48%] bg-white/10 md:w-[50%] xl:w-[52%] 2xl:w-[56%]"
        aria-hidden="true"
      />
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-6 flex items-end justify-between gap-6">
          <div className="aureo-mono-label text-[#C5A67C]">CORE MODULES · DEPLOYED ON ARC</div>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgba(234,228,216,0.45)]">
            04 contracts live
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-4">
          {modules.map((m, i) => (
            <div
              key={m.t}
              className="group relative rounded-sm border border-white/10 bg-[rgba(10,10,10,0.45)] px-4 py-3 transition-all duration-300 hover:border-[#C5A67C]/35 hover:bg-[rgba(18,18,18,0.62)]"
              style={{ animation: `fadeInUp 0.5s ${0.1 + i * 0.06}s both cubic-bezier(0.16, 1, 0.3, 1)` }}
            >
              <div className="flex items-start gap-3">
                <span className="mt-[2px] shrink-0 aureo-mono-label text-[#C5A67C]">{`0${i + 1}`}</span>
                <div className="min-w-0">
                  <h3 className="aureo-display text-[18px] leading-tight text-[#EAE4D8] md:text-[20px]">
                    {m.t}
                  </h3>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[rgba(234,228,216,0.62)] md:text-[10.5px]">
                    {m.s}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
