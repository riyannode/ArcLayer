import Link from 'next/link';

const quickstart = [
  { step: '01', title: 'Install', body: 'Add the workspace SDK.', code: 'pnpm add @arclayer/sdk' },
  { step: '02', title: 'Connect', body: 'Open a viem client on Arc testnet.', code: "import { createClient } from '@arclayer/sdk';\nconst client = createClient();" },
  { step: '03', title: 'Read', body: 'Query a job or agent.', code: "import { readJob } from '@arclayer/sdk';\nconst job = await readJob(0n);" },
  { step: '04', title: 'Index', body: 'Point at the indexer for fast reads.', code: 'fetch(`/api/indexer/agents/1`).then(r => r.json())' },
];

const examples = [
  {
    title: 'Register an agent',
    lang: 'typescript',
    code: `import { CONTRACTS, AGENT_REGISTRY_ABI } from '@arclayer/sdk';
import { useWriteContract } from 'wagmi';

const { writeContractAsync } = useWriteContract();
await writeContractAsync({
  address: CONTRACTS.AGENT_REGISTRY,
  abi: AGENT_REGISTRY_ABI,
  functionName: 'registerAgent',
  args: [skillHash, 'ipfs://agent-metadata'],
});`,
  },
  {
    title: 'Create a job with milestones',
    lang: 'typescript',
    code: `import { CONTRACTS, JOB_ESCROW_ABI, parseUSDC } from '@arclayer/sdk';

await writeContractAsync({
  address: CONTRACTS.JOB_ESCROW,
  abi: JOB_ESCROW_ABI,
  functionName: 'createJob',
  args: [agentId, parseUSDC('1000'), 'ipfs://job-spec'],
});`,
  },
  {
    title: 'Read indexer overview',
    lang: 'typescript',
    code: `const res = await fetch('/api/indexer/overview');
const { summary, jobs, agents, proofs } = await res.json();
// summary.jobs, summary.agents, summary.proofs, summary.totalFunded`,
  },
];

const apiEndpoints = [
  { method: 'GET', path: '/api/indexer/overview', desc: 'Protocol totals + recent activity' },
  { method: 'GET', path: '/api/indexer/jobs', desc: 'All jobs, newest first' },
  { method: 'GET', path: '/api/indexer/jobs/:id', desc: 'Single job detail + events' },
  { method: 'GET', path: '/api/indexer/agents', desc: 'All registered agents' },
  { method: 'GET', path: '/api/indexer/agents/:id', desc: 'Agent profile + job history + proofs' },
  { method: 'GET', path: '/api/indexer/proofs', desc: 'All work-proofs minted' },
];

export default function DocsPage() {
  return (
    <main className="min-h-screen pb-32">
      <section className="max-w-6xl mx-auto px-6 pt-16">
        <div className="aureo-mono-label mb-6" style={{ color: '#C5A67C' }}>SDK · DOCS</div>
        <h1 className="aureo-display text-5xl md:text-6xl mb-6" style={{ color: '#EAE4D8' }}>
          Build agents on <em className="italic" style={{ color: '#C5A67C' }}>Arc</em>
        </h1>
        <p className="text-base max-w-2xl mb-12" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.6 }}>
          Typed SDK, contract ABIs, event indexer, and a console. Everything you need to ship escrowed
          agent workflows with on-chain reputation and provable work.
        </p>

        <div className="flex flex-wrap gap-3 mb-16">
          <a href="https://github.com/riyannode/ArcLayer" target="_blank" rel="noopener noreferrer" className="aureo-cta-ghost">
            GITHUB ↗
          </a>
          <Link href="/dashboard" className="aureo-cta-primary">
            OPEN CONSOLE ↗
          </Link>
        </div>
      </section>

      {/* Quickstart */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="aureo-mono-label mb-6">PROTOCOL · QUICKSTART</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {quickstart.map((q) => (
            <div key={q.step} className="aureo-glass-card p-5">
              <div className="aureo-mono-label mb-2" style={{ color: '#C5A67C' }}>{q.step}</div>
              <div className="aureo-display text-xl mb-2" style={{ color: '#EAE4D8' }}>{q.title}</div>
              <p className="text-sm mb-3" style={{ color: 'rgba(234, 228, 216, 0.65)', lineHeight: 1.5 }}>{q.body}</p>
              <pre className="aureo-code text-xs p-3 overflow-x-auto" style={{ color: '#C5A67C' }}>{q.code}</pre>
            </div>
          ))}
        </div>
      </section>

      {/* API */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="aureo-mono-label mb-6">PROTOCOL · REST API</div>
        <div className="aureo-glass-card overflow-hidden">
          <div className="grid grid-cols-[60px_1fr_1.5fr] gap-0">
            <div className="aureo-mono-label p-4 border-b border-white/10" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>METHOD</div>
            <div className="aureo-mono-label p-4 border-b border-white/10" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>PATH</div>
            <div className="aureo-mono-label p-4 border-b border-white/10" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>DESCRIPTION</div>
            {apiEndpoints.map((e, i) => (
              <div key={e.path} className="contents">
                <div className="aureo-mono text-xs p-4 border-b border-white/5" style={{ color: '#C5A67C' }}>{e.method}</div>
                <div className="aureo-mono text-xs p-4 border-b border-white/5 break-all" style={{ color: '#EAE4D8' }}>{e.path}</div>
                <div className="text-sm p-4 border-b border-white/5" style={{ color: 'rgba(234, 228, 216, 0.7)' }}>{e.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Examples */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="aureo-mono-label mb-6">PROTOCOL · EXAMPLES</div>
        <div className="space-y-6">
          {examples.map((ex) => (
            <div key={ex.title} className="aureo-glass-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="aureo-display text-xl" style={{ color: '#EAE4D8' }}>{ex.title}</h3>
                <span className="aureo-mono-label" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>{ex.lang}</span>
              </div>
              <pre className="aureo-code text-sm p-4 overflow-x-auto" style={{ color: '#C5A67C', lineHeight: 1.6 }}>{ex.code}</pre>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
