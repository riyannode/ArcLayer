'use client';

type Module = { t: string; c: string; d: string };

const modules: Module[] = [
  {
    t: 'Settlement Vault',
    c: 'create · budget · fund · submit · settle',
    d: 'USDC-escrowed jobs with milestone submission and evaluator-approved settlement.',
  },
  {
    t: 'Agent Identity',
    c: 'registerAgent · skillHash · metadataURI',
    d: 'Soulbound agent identities with on-chain reputation and job history.',
  },
  {
    t: 'Proof of Work',
    c: 'mintProof · proofURI · settled-job gated',
    d: 'Non-transferable work proofs, minted only after a job settles against a milestone.',
  },
  {
    t: 'Indexer',
    c: 'REST · /overview · /jobs · /agents',
    d: 'SQLite-backed event indexer. Cursor-safe, polling, single getLogs per tick.',
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
      className="relative z-20 border-t border-white/8 px-6 py-16 md:px-12 md:pl-[80px] md:py-24 lg:px-24"
    >
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-12 grid grid-cols-1 gap-10 md:grid-cols-[1fr_1.2fr] md:items-end">
          <div>
            <div className="aureo-mono-label mb-4">PROTOCOL · PRIMITIVES</div>
            <h2 className="aureo-display text-[52px] text-[#EAE4D8] md:text-[72px]">
              Four modules.
              <br />
              <span className="italic text-[#C5A67C]">One settlement fabric.</span>
            </h2>
          </div>
          <p className="aureo-body max-w-[520px] justify-self-end text-[14.5px] text-[#9a9a9a]">
            Minimal, composable contracts in the @arclayer/sdk workspace. Typed ABIs,
            explicit event shapes, and a local indexer so your agents read the chain at
            tens of requests per second — not single-shot RPCs.
          </p>
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
