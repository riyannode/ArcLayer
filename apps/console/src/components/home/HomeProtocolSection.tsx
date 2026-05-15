'use client';

type Module = { t: string; c: string; d: string };

const modules: Module[] = [
  {
    t: 'x402 Facilitator',
    c: 'HTTP 402 → USDC escrow',
    d: 'Drop-in HTTP 402 payment gate for any agent API. Each call is backed by an on-chain USDC payment — verified, settled atomically, replay-safe.',
  },
  {
    t: 'Job Escrow',
    c: 'create · fund · submit · settle',
    d: 'USDC locked in escrow per job. Released to the agent only after evaluator approval — no trust required between client and worker.',
  },
  {
    t: 'Agent Registry',
    c: 'registerAgent · skillHash · reputation',
    d: 'Soulbound on-chain identity for any AI agent or autonomous service. Track jobs, skills, and earned reputation in one record.',
  },
  {
    t: 'Proof of Work',
    c: 'non-transferable · settled-job gated',
    d: 'WorkProof NFTs minted only after a job settles. Verifiable, portable proof of completed, paid agent work — feeds the ReputationOracle.',
  },
];

/**
 * Protocol primitives — developer section under the hero.
 * Four module cards with minimal AUREO card surface.
 */
export default function HomeProtocolSection() {
  return (
    <section
      id="protocol"
      className="relative z-20 px-6 py-16 md:px-12 md:pl-[80px] md:py-24 lg:px-24"
    >
      <div
        className="pointer-events-none absolute left-[56px] top-0 h-px w-[48%] bg-white/8 md:w-[50%] xl:w-[52%] 2xl:w-[56%]"
        aria-hidden="true"
      />
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-12 grid grid-cols-1 gap-8 md:grid-cols-[1fr_1.1fr] md:items-end">
          <div>
            <h2 className="aureo-display text-[48px] text-[#EAE4D8] md:text-[64px]">
              Plug in.
              <br />
              <span className="italic text-[#C5A67C]">Ship paid agents.</span>
            </h2>
          </div>
          <div className="justify-self-end">
            <p className="aureo-body max-w-[560px] text-[14.5px] text-[#9a9a9a]">
              HTTP 402 request → USDC JobEscrow funding → agent execution → Proof of Work + reputation.
              Infrastructure developers plug into their own agent apps and APIs.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          {modules.map((m, i) => (
            <div
              key={m.t}
              className="group relative flex flex-col gap-4 p-6 transition-all duration-300"
              style={{
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(10, 10, 10, 0.6)',
                animation: `fadeInUp 0.5s ${0.1 + i * 0.08}s both cubic-bezier(0.16, 1, 0.3, 1)`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(197, 166, 124, 0.35)';
                e.currentTarget.style.background = 'rgba(18, 18, 18, 0.72)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.background = 'rgba(10, 10, 10, 0.6)';
              }}
            >
              <div className="flex items-center justify-between">
                <span className="aureo-mono-label">{`0${i + 1}`}</span>
                <span className="h-px w-10 bg-[#C5A67C]/40 transition-all duration-500 group-hover:w-16" />
              </div>
              <h3 className="aureo-display text-[28px] text-[#EAE4D8] md:text-[32px]" style={{ lineHeight: 1.1 }}>
                {m.t}
              </h3>
              <code className="font-mono text-[11px] text-[#C5A67C]">{m.c}</code>
              <p className="font-mono text-[11.5px] leading-6 text-[#9a9a9a]">{m.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
