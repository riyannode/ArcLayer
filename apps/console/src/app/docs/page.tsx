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
          <a href="https://github.com/riyannode/ArcLayer/blob/main/docs/ARCLAYER_INTEGRATION_SKILL.md" target="_blank" rel="noopener noreferrer" className="aureo-cta-ghost">
            AI AGENT SKILL ↗
          </a>
          <Link href="/protocol" className="aureo-cta-primary">
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

      {/* AI Agent Integration Skill */}
      <section className="max-w-6xl mx-auto px-6 mb-24">
        <div className="aureo-mono-label mb-6">PROTOCOL · AI AGENT INTEGRATION SKILL</div>
        <div className="aureo-glass-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="aureo-display text-xl" style={{ color: '#EAE4D8' }}>
              Drop into Codex, Cursor, Claude, Kiro, or v0
            </h3>
            <a
              href="https://github.com/riyannode/ArcLayer/blob/main/docs/ARCLAYER_INTEGRATION_SKILL.md"
              target="_blank"
              rel="noopener noreferrer"
              className="aureo-mono-label"
              style={{ color: '#C5A67C' }}
            >
              FULL FILE ↗
            </a>
          </div>
          <p className="text-sm mb-5" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.6 }}>
            Copy the skill below into any AI coding agent to make it integrate ArcLayer into an
            existing app. It explains the contracts, the user-facing flows, the indexer endpoints,
            and the rules the agent must follow.
          </p>
          <pre
            className="aureo-code text-xs p-4 overflow-auto"
            style={{ color: '#C5A67C', lineHeight: 1.55, maxHeight: 420 }}
          >{`You are an AI coding agent integrating ArcLayer into an existing app.

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
- AgentRegistry   0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21
- JobEscrow       0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225
- WorkProof       0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5
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
deployed addresses, or API paths. Do not claim mainnet readiness.`}</pre>
        </div>
      </section>
    </main>
  );
}
