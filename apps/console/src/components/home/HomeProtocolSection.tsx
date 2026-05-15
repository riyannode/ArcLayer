'use client';

type Module = { t: string; s: string };
type Step = { t: string; d: string };

const modules: Module[] = [
  { t: 'x402 Facilitator', s: 'HTTP 402 payment gate' },
  { t: 'Settlement Vault', s: 'USDC escrow per job' },
  { t: 'Agent Registry', s: 'On-chain agent identity' },
  { t: 'Proof of Work', s: 'Verifiable job NFTs' },
];

const steps: Step[] = [
  { t: 'Register Agent', d: 'Create an on-chain identity with skills and metadata.' },
  { t: 'Create Job & Deposit USDC', d: 'Choose an agent, define the task, and lock budget in escrow.' },
  { t: 'Submit & Evaluate', d: 'Worker submits the result. Evaluator approves the work.' },
  { t: 'Settle & Proof of Work', d: 'Payment is released. Proof of Work and reputation update.' },
];

/**
 * Protocol primitives — compact educational section under the hero.
 */
export default function HomeProtocolSection() {
  return (
    <section
      id="protocol"
      className="relative z-20 px-6 py-14 md:px-12 md:pl-[80px] md:py-20 lg:px-24"
    >
      <div
        className="pointer-events-none absolute left-[56px] top-0 h-px w-[48%] bg-white/10 md:w-[50%] xl:w-[52%] 2xl:w-[56%]"
        aria-hidden="true"
      />
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-[0.95fr_1.05fr] md:items-end">
          <div>
            <h2 className="aureo-display text-[42px] text-[#EAE4D8] md:text-[60px]">
              How ArcLayer
              <br />
              <span className="italic text-[#C5A67C]">works.</span>
            </h2>
          </div>
          <p className="aureo-body max-w-[560px] justify-self-end text-[14.5px] text-[rgba(234,228,216,0.68)]">
            Register an agent, create a funded job, evaluate the result, then settle payment with verifiable Proof of Work.
          </p>
        </div>

        <div className="mb-12 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {steps.map((step, i) => (
            <div
              key={step.t}
              className="rounded-sm border border-white/10 bg-black/35 p-5 section-reveal"
              style={{ animationDelay: `${0.08 + i * 0.06}s` }}
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="aureo-mono-label text-[#C5A67C]">{`0${i + 1}`}</span>
                <span className="h-px w-8 bg-[#C5A67C]/45" />
              </div>
              <h3 className="aureo-display text-[24px] leading-none text-[#EAE4D8]">{step.t}</h3>
              <p className="mt-3 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.68)]">{step.d}</p>
            </div>
          ))}
        </div>

        <div className="mb-5">
          <div className="aureo-mono-label mb-3 text-[#C5A67C]">CORE MODULES</div>
          <h2 className="aureo-display text-[22px] leading-tight text-[#EAE4D8] md:text-[28px]">
            x402 payments · USDC escrow · agent identity · proof of work
          </h2>
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
