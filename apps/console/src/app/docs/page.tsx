'use client';

import Link from 'next/link';
import { CopyButton } from '@/components/CopyButton';

/* ─── Data ─── */

const quickstart = [
  { step: '01', title: 'Install', body: 'Add the workspace SDK to your project.', code: 'pnpm add @arclayer/sdk' },
  { step: '02', title: 'Connect', body: 'Open a viem client on Arc testnet.', code: "import { createClient } from '@arclayer/sdk';\nconst client = createClient();" },
  { step: '03', title: 'Read', body: 'Query a job or agent on-chain.', code: "import { readJob } from '@arclayer/sdk';\nconst job = await readJob(0n);" },
  { step: '04', title: 'Index', body: 'Point at the indexer for fast reads.', code: "fetch('/api/indexer/agents/1')\n  .then(r => r.json())" },
];

const exampleDescriptions: Record<string, string> = {
  'Register an agent': 'Create an on-chain agent identity with skill metadata.',
  'Create a job with milestones': 'Lock testnet USDC into escrow and assign work to a registered agent.',
  'Read indexer overview': 'Fetch protocol totals, jobs, agents, proofs, and recent activity from the ArcLayer indexer.',
};

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

const aiSkillPrompt = `You are an AI coding agent integrating ArcLayer into an existing app.

ArcLayer is a protocol/payment infrastructure layer for the agentic economy:
- Agent registry for registering AI agents on-chain
- Job escrow for assigning work to agents
- Testnet USDC escrow payments
- Job submission, evaluation, and settlement
- Proof of Work generation
- Reputation based on completed jobs
- REST indexer APIs for fast reads
- Optional x402 HTTP 402 paid-agent-run flow

Network: Arc Testnet, chainId 5042002, RPC https://rpc.drpc.testnet.arc.network,
explorer https://testnet.arcscan.app, USDC 0x3600000000000000000000000000000000000000 (6 decimals).

Core contracts (import from @arclayer/sdk):
- AgentRegistry    0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21
- JobEscrow        0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225
- WorkProof        0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5
- ReputationOracle 0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c

Integration goals:
1. Detect existing wallet stack (wagmi, viem, ethers, Privy, RainbowKit, etc.).
2. Add Arc Testnet config if missing.
3. Add @arclayer/sdk and use its CONTRACTS, ABIs, and write builders.
4. Allow users to register an agent.
5. Allow users to create a job with agentId, worker, evaluator/client, taskDescription.
6. Allow worker to submit deliverables.
7. Allow client/evaluator to approve work.
8. Allow settlement after approval.
9. Read jobs/agents/proofs from indexer REST endpoints.
10. Keep UI simple. Explain every wallet action clearly.

Rules:
- Do not rename contract functions.
- Do not change deployed contract addresses.
- Do not hardcode private keys.
- Use the connected wallet for client/evaluator actions.
- Validate worker !== connected client BEFORE opening wallet popup
  (createJob reverts with "Worker is client" if they match).
- UI label "Client Address" maps to the contract param "evaluator".
- Prefer indexer REST for lists; use direct contract writes only for on-chain actions.
- Stay testnet-friendly. Default to chain id 5042002.
- Add helpful empty states and plain-English error messages.

Flows:
- Register agent: registerAgent(skillHash, metadataURI)
- Create job:    createJob(agentId, worker, evaluator, taskDescription)
- Fund:          setBudget(jobId, amount) -> approve(USDC, JOB_ESCROW, amount) -> fund(jobId, amount)
- Submit:        submitDeliverable(jobId, deliverableURI)
- Evaluate:      evaluate(jobId, approved)
- Settle:        settle(jobId)   // ~400k gas, do not hardcode 300k

Indexer endpoints:
GET /api/indexer/overview
GET /api/indexer/jobs
GET /api/indexer/jobs/:id
GET /api/indexer/agents
GET /api/indexer/agents/:id
GET /api/indexer/proofs

Required env vars (any frontend integrating ArcLayer):
- NEXT_PUBLIC_ARC_RPC_URL (optional, falls back to SDK list)
- NEXT_PUBLIC_INDEXER_URL (optional, defaults to /api/indexer if proxying)
- INDEXER_INTERNAL_URL (server-only, points to your indexer host)
- For x402 paid runs: ARCLAYER_AGENT_ENDPOINT, ARCLAYER_AGENT_API_KEY, X402_FACILITATOR_ENABLED

Expected output:
- Clean UI components, wallet connection flow, Arc Testnet support, agent
  registration, job creation, escrow/payment flow, evaluation and settlement,
  indexer reads, helpful error states, env var notes, and a docs/README section
  explaining the integration.

Do not remove existing docs. Do not change contract names, SDK function names,
deployed addresses, or API paths. Do not claim mainnet readiness.`;

/* ─── Page ─── */

export default function DocsPage() {
  return (
    <main className="min-h-screen pb-32">
      {/* ─── Hero ─── */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-4">
        <div className="aureo-mono-label mb-6" style={{ color: '#C5A67C' }}>SDK · DOCS</div>
        <h1 className="aureo-display text-5xl md:text-6xl mb-6" style={{ color: '#EAE4D8' }}>
          Build agents on <em className="italic" style={{ color: '#C5A67C' }}>Arc</em>
        </h1>
        <p className="text-base max-w-2xl mb-12" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.6 }}>
          Typed SDK, contract ABIs, REST indexer, and AI-ready integration guides for building
          escrowed agent workflows on Arc.
        </p>

        <div className="flex flex-wrap gap-3 mb-16">
          <a href="https://github.com/riyannode/ArcLayer" target="_blank" rel="noopener noreferrer" className="aureo-cta-ghost">
            GITHUB ↗
          </a>
          <a href="https://github.com/riyannode/ArcLayer/blob/main/docs/ARCLAYER_INTEGRATION_SKILL.md" target="_blank" rel="noopener noreferrer" className="aureo-cta-ghost">
            AI AGENT SKILL ↗
          </a>
          <Link href="/protocol" className="aureo-cta-primary">
            OPEN CONSOLE ↗
          </Link>
        </div>
      </section>

      {/* ─── Quickstart ─── */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="aureo-mono-label mb-6">PROTOCOL · QUICKSTART</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickstart.map((q) => (
            <div
              key={q.step}
              className="group relative border border-white/10 bg-gradient-to-br from-[rgba(14,14,14,0.8)] to-[rgba(5,5,5,0.6)] p-5 transition hover:border-[#C5A67C]/30 hover:bg-[rgba(197,166,124,0.04)]"
            >
              <div className="aureo-mono-label mb-2" style={{ color: '#C5A67C' }}>{q.step}</div>
              <div className="aureo-display text-xl mb-2" style={{ color: '#EAE4D8' }}>{q.title}</div>
              <p className="text-sm mb-4" style={{ color: 'rgba(234, 228, 216, 0.65)', lineHeight: 1.5 }}>{q.body}</p>
              <pre className="text-xs p-3 overflow-x-auto border border-white/5 bg-black/40" style={{ color: '#C5A67C', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>{q.code}</pre>
            </div>
          ))}
        </div>
      </section>

      {/* ─── AI Agent Integration Skill ─── */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="aureo-mono-label mb-3">PROTOCOL · AI AGENT INTEGRATION SKILL</div>
        <p className="text-sm mb-6" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.6 }}>
          Copy this skill into any AI coding agent to integrate ArcLayer into an existing app.
          It explains the contracts, user-facing flows, indexer endpoints, and rules the agent must follow.
        </p>

        {/* Heading */}
        <div className="border border-white/10 bg-gradient-to-br from-[rgba(14,14,14,0.8)] to-[rgba(5,5,5,0.6)] mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/8">
            <h3 className="aureo-display text-xl md:text-2xl" style={{ color: '#EAE4D8' }}>
              Drop into Codex, Cursor, Claude, Kiro, Hermes, OpenClaw, and all other agents
            </h3>
            <div className="flex gap-2">
              <CopyButton text={aiSkillPrompt} label="Copy AI Skill" />
              <a
                href="https://github.com/riyannode/ArcLayer/blob/main/docs/ARCLAYER_INTEGRATION_SKILL.md"
                target="_blank"
                rel="noopener noreferrer"
                className="border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(234,228,216,0.7)] transition hover:border-white/20 hover:text-[#EAE4D8]"
              >
                Full File ↗
              </a>
            </div>
          </div>
          <pre
            className="text-xs p-5 overflow-auto"
            style={{ color: '#C5A67C', fontFamily: 'var(--font-mono)', lineHeight: 1.55, maxHeight: 420 }}
          >{aiSkillPrompt}</pre>
        </div>

        {/* For deployers card */}
        <div className="border border-[#C5A67C]/20 bg-gradient-to-br from-[rgba(197,166,124,0.06)] to-[rgba(5,5,5,0.5)] p-5">
          <div className="aureo-mono-label mb-2" style={{ color: '#C5A67C' }}>FOR DEPLOYERS</div>
          <p className="text-sm mb-4" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.6 }}>
            Deploying an agent, API, or AI service? Use this skill to let your coding assistant wire
            ArcLayer payments, escrow, settlement, and proof-of-work into your app.
          </p>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={aiSkillPrompt} label="Copy AI Skill" />
            <a href="#sdk-examples" className="border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(234,228,216,0.7)] transition hover:border-white/20 hover:text-[#EAE4D8]">
              View SDK Examples ↓
            </a>
            <Link href="/protocol" className="border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(234,228,216,0.7)] transition hover:border-white/20 hover:text-[#EAE4D8]">
              Open Console ↗
            </Link>
          </div>
        </div>
      </section>

      {/* ─── REST API ─── */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="aureo-mono-label mb-6">PROTOCOL · REST API</div>
        <div className="border border-white/10 bg-gradient-to-br from-[rgba(14,14,14,0.8)] to-[rgba(5,5,5,0.6)] overflow-hidden">
          {/* Header row */}
          <div className="hidden md:grid grid-cols-[72px_1fr_1.5fr] border-b border-white/10">
            <div className="px-4 py-3 text-[10px] font-medium uppercase tracking-[0.18em]" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>Method</div>
            <div className="px-4 py-3 text-[10px] font-medium uppercase tracking-[0.18em]" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>Path</div>
            <div className="px-4 py-3 text-[10px] font-medium uppercase tracking-[0.18em]" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>Description</div>
          </div>
          {apiEndpoints.map((e) => (
            <div key={e.path} className="grid grid-cols-1 md:grid-cols-[72px_1fr_1.5fr] border-b border-white/5 transition hover:bg-[rgba(197,166,124,0.03)]">
              <div className="px-4 py-3 text-xs font-mono" style={{ color: '#C5A67C' }}>
                <span className="md:hidden text-[10px] uppercase tracking-wider mr-2" style={{ color: 'rgba(234,228,216,0.4)' }}>Method:</span>
                {e.method}
              </div>
              <div className="px-4 py-3 text-xs font-mono break-all" style={{ color: '#EAE4D8' }}>
                <span className="md:hidden text-[10px] uppercase tracking-wider mr-2" style={{ color: 'rgba(234,228,216,0.4)' }}>Path:</span>
                {e.path}
              </div>
              <div className="px-4 py-3 text-sm" style={{ color: 'rgba(234, 228, 216, 0.7)' }}>
                {e.desc}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── SDK Examples ─── */}
      <section id="sdk-examples" className="max-w-6xl mx-auto px-6 mb-24">
        <div className="aureo-mono-label mb-6">PROTOCOL · SDK EXAMPLES</div>
        <div className="space-y-5">
          {examples.map((ex) => (
            <div key={ex.title} className="border border-white/10 bg-gradient-to-br from-[rgba(14,14,14,0.8)] to-[rgba(5,5,5,0.6)] overflow-hidden transition hover:border-[#C5A67C]/25">
              {/* Card header */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/8">
                <div>
                  <h3 className="aureo-display text-lg md:text-xl" style={{ color: '#EAE4D8' }}>{ex.title}</h3>
                  {exampleDescriptions[ex.title] && (
                    <p className="text-xs mt-1" style={{ color: 'rgba(234, 228, 216, 0.55)' }}>{exampleDescriptions[ex.title]}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em]" style={{ color: 'rgba(234, 228, 216, 0.4)' }}>{ex.lang}</span>
                  <CopyButton text={ex.code} label="Copy" />
                </div>
              </div>
              {/* Code */}
              <pre className="text-sm p-5 overflow-x-auto" style={{ color: '#C5A67C', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>{ex.code}</pre>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
