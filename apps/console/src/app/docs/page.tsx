import fs from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import { MDXRemote } from 'next-mdx-remote/rsc';

const quickstart = [
  { step: '01', title: 'Install', body: 'Add the typed workspace SDK to your project.', code: 'pnpm add @arclayer/sdk' },
  { step: '02', title: 'Read', body: 'Import contract metadata and a read helper.', code: "import { CONTRACTS, readJob } from '@arclayer/sdk'" },
  { step: '03', title: 'Write', body: 'Build a wagmi-compatible write config.', code: 'const tx = buildRegisterAgentConfig(agentId, skill, uri)' },
  { step: '04', title: 'Index', body: 'Point at the indexer for fast reads.', code: 'fetch(`${INDEXER_URL}/agents/1`).then(r => r.json())' },
];

const sdkExamples = [
  {
    title: 'Read protocol addresses and load a job',
    tag: 'READ',
    code: `import { CONTRACTS, readJob } from '@arclayer/sdk';

const job = await readJob(0n);
console.log(CONTRACTS.JOB_ESCROW, job);`,
  },
  {
    title: 'Register and submit with write helpers',
    tag: 'WRITE',
    code: `import { createArcClient, registerAgent, submitDeliverable } from '@arclayer/sdk';

const client = createArcClient({ account, transport });
await registerAgent(client, {
  agentId: 12n,
  skillHash: '0xabc123...',
  metadataURI: 'ipfs://agent-profile',
});

await submitDeliverable(client, {
  jobId: 8n,
  deliverableURI: 'ipfs://deliverable',
  proofMetadataURI: 'ipfs://proof',
});`,
  },
  {
    title: 'Query indexer for agent telemetry',
    tag: 'INDEX',
    code: `const res = await fetch(process.env.NEXT_PUBLIC_INDEXER_URL + '/agents/1');
const profile = await res.json();
console.log(profile.agent.score, profile.jobs.length, profile.proofs.length);`,
  },
];

async function loadBuildPlanMdx() {
  const buildPlanPath = path.join(process.cwd(), '..', '..', 'docs', 'arclayer-build-plan.md');
  try {
    return await fs.readFile(buildPlanPath, 'utf8');
  } catch {
    return '> Build plan unavailable in this build.';
  }
}

export default async function DocsPage() {
  const buildPlan = await loadBuildPlanMdx();

  return (
    <div className="relative px-6 py-16 md:px-10 md:py-24">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-10">
          <div className="aureo-mono-label mb-3">PROTOCOL · SDK</div>
          <h1 className="aureo-display text-[48px] text-[#EAE4D8] md:text-[72px]">
            Build on the <span className="italic text-[#C5A67C]">protocol layer</span>
          </h1>
          <p className="mt-4 max-w-3xl font-mono text-[12.5px] leading-6 text-[#9a9a9a]">
            The repo exposes a workspace SDK (<span className="text-[#C5A67C]">@arclayer/sdk</span>), a standalone indexer,
            and this console. Below: quickstart, SDK surface, and the full build plan.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <span className="tag-pill">typescript</span>
            <span className="tag-pill">wagmi / viem</span>
            <span className="tag-pill">next.js app router</span>
            <span className="tag-pill">arc testnet · 5042002</span>
          </div>
        </div>

        {/* Quickstart grid */}
        <div className="mb-14 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {quickstart.map((q, i) => (
            <div
              key={q.step}
              className="flex flex-col gap-3 p-5"
              style={{
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(10, 10, 10, 0.6)',
                animation: `fadeInUp 0.4s ${0.05 + i * 0.07}s both cubic-bezier(0.16, 1, 0.3, 1)`,
              }}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] tracking-[0.18em] text-[#C5A67C]">{q.step}</span>
                <span className="h-px w-10 bg-[#C5A67C]/40" />
              </div>
              <h3 className="aureo-display text-[24px] text-[#EAE4D8]">{q.title}</h3>
              <p className="font-mono text-[11px] leading-5 text-[#9a9a9a]">{q.body}</p>
              <code className="block overflow-x-auto border-l-2 border-[#C5A67C] bg-black/40 px-3 py-2 font-mono text-[10.5px] text-[#EAE4D8]">
                {q.code}
              </code>
            </div>
          ))}
        </div>

        {/* SDK examples */}
        <div className="mb-14">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <div className="aureo-mono-label mb-2">SDK · EXAMPLES</div>
              <h2 className="aureo-display text-[36px] text-[#EAE4D8] md:text-[48px]">Typed entry-points</h2>
            </div>
            <a
              href="https://github.com/riyannode/ArcLayer/tree/main/sdk"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-bordered"
            >
              SOURCE ↗
            </a>
          </div>

          <div className="space-y-4">
            {sdkExamples.map((ex, i) => (
              <div
                key={ex.title}
                className="overflow-hidden"
                style={{
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  background: 'rgba(10, 10, 10, 0.6)',
                  animation: `fadeInUp 0.4s ${i * 0.08}s both cubic-bezier(0.16, 1, 0.3, 1)`,
                }}
              >
                <div className="flex items-center justify-between border-b border-white/8 px-5 py-3" style={{ background: 'rgba(197, 166, 124, 0.03)' }}>
                  <h3 className="aureo-display text-[20px] text-[#EAE4D8]">{ex.title}</h3>
                  <span className="tag-pill">{ex.tag}</span>
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-6 text-[#EAE4D8]">{ex.code}</pre>
              </div>
            ))}
          </div>
        </div>

        {/* Build plan MDX */}
        <div className="mb-10">
          <div className="mb-6">
            <div className="aureo-mono-label mb-2">PROTOCOL · BUILD PLAN</div>
            <h2 className="aureo-display text-[36px] text-[#EAE4D8] md:text-[48px]">Architecture</h2>
          </div>

          <section
            className="prose-arc p-8"
            style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(10, 10, 10, 0.55)' }}
          >
            <MDXRemote source={buildPlan} />
          </section>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard" className="btn-primary">OPEN CONSOLE</Link>
          <Link href="/jobs" className="btn-bordered">INSPECT JOBS</Link>
          <Link href="/agents" className="btn-bordered">BROWSE AGENTS</Link>
        </div>
      </div>
    </div>
  );
}
