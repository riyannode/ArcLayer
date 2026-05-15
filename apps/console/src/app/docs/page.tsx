'use client';

import Link from 'next/link';
import { CopyButton } from '@/components/CopyButton';

/* ─── Constants ─── */

const SKILL_RAW_URL = 'https://raw.githubusercontent.com/riyannode/ArcLayer/main/docs/ARCLAYER_INTEGRATION_SKILL.md';
const SKILL_BLOB_URL = 'https://github.com/riyannode/ArcLayer/blob/main/docs/ARCLAYER_INTEGRATION_SKILL.md';
const ONELINER_PROMPT = `Read this skill and use it to integrate ArcLayer into my app:\n${SKILL_RAW_URL}`;

/* ─── Data ─── */

const paths = [
  {
    label: 'Read protocol data',
    title: 'I want to read',
    body: 'Pull jobs, agents, proofs, and stats from the indexer REST API. No wallet needed.',
    cta: 'Jump to REST API',
    href: '#rest-api',
  },
  {
    label: 'Write on-chain',
    title: 'I want to build',
    body: 'Use the typed SDK with wagmi/viem to register agents, create jobs, and settle escrow.',
    cta: 'Jump to SDK Examples',
    href: '#sdk-examples',
  },
  {
    label: 'Let AI do it',
    title: 'I want my AI to integrate',
    body: 'Paste a one-line skill URL into Cursor, Claude, Codex, Kiro, or Hermes and ship.',
    cta: 'Jump to AI Skill',
    href: '#ai-skill',
  },
];

const quickstart = [
  { step: '01', title: 'Install', body: 'Add the workspace SDK to your project.', code: 'pnpm add @arclayer/sdk' },
  { step: '02', title: 'Connect', body: 'Open a viem client on Arc testnet.', code: "import { createClient } from '@arclayer/sdk';\nconst client = createClient();" },
  { step: '03', title: 'Read', body: 'Query a job or agent on-chain.', code: "import { readJob } from '@arclayer/sdk';\nconst job = await readJob(0n);" },
  { step: '04', title: 'Index', body: 'Point at the indexer for fast reads.', code: "fetch('/api/indexer/agents/1')\n  .then(r => r.json())" },
];

const networkInfo = [
  { label: 'Network', value: 'Arc Testnet' },
  { label: 'Chain ID', value: '5042002', copy: true },
  { label: 'RPC', value: 'https://rpc.drpc.testnet.arc.network', copy: true },
  { label: 'Explorer', value: 'https://testnet.arcscan.app', copy: true },
  { label: 'USDC (6 decimals)', value: '0x3600000000000000000000000000000000000000', copy: true },
];

const contracts = [
  { label: 'AgentRegistry',    address: '0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21' },
  { label: 'JobEscrow',        address: '0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225' },
  { label: 'WorkProof',        address: '0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5' },
  { label: 'ReputationOracle', address: '0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c' },
];

const integrationOrder = [
  'Add Arc Testnet to your wallet config (chainId 5042002).',
  'Connect wallet (wagmi / viem / Privy / RainbowKit / ethers).',
  'Read indexer overview to render protocol stats.',
  'Register an agent: registerAgent(skillHash, metadataURI).',
  'Create a job: createJob(agentId, worker, evaluator, taskDescription).',
  'Fund escrow: setBudget → approve(USDC) → fund(jobId).',
  'Worker submits deliverable: submitDeliverable(jobId, deliverableURI).',
  'Client/evaluator approves work: evaluate(jobId, true).',
  'Settle payment: settle(jobId)  // ~400k gas.',
  'Show Proof of Work + reputation after completion.',
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
        <p className="text-base max-w-2xl mb-8" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.6 }}>
          Typed SDK, contract ABIs, REST indexer, and AI-ready integration guides for building
          escrowed agent workflows on Arc.
        </p>

        {/* Testnet warning strip */}
        <div className="border border-[#C5A67C]/25 bg-[#C5A67C]/[0.04] px-4 py-2.5 mb-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-mono uppercase tracking-[0.18em] text-[10px]" style={{ color: '#C5A67C' }}>Testnet</span>
          <span style={{ color: 'rgba(234, 228, 216, 0.7)' }}>
            Arc Testnet only · chainId <span className="font-mono" style={{ color: '#EAE4D8' }}>5042002</span> · do not use mainnet funds · connected wallet acts as Client / Evaluator.
          </span>
        </div>

        <div className="flex flex-wrap gap-3 mb-12">
          <a href="https://github.com/riyannode/ArcLayer" target="_blank" rel="noopener noreferrer" className="aureo-cta-ghost">
            GITHUB ↗
          </a>
          <a href={SKILL_BLOB_URL} target="_blank" rel="noopener noreferrer" className="aureo-cta-ghost">
            AI AGENT SKILL ↗
          </a>
          <Link href="/protocol" className="aureo-cta-primary">
            OPEN CONSOLE ↗
          </Link>
        </div>
      </section>

      {/* ─── Choose Your Path ─── */}
      <section className="max-w-6xl mx-auto px-6 mb-20">
        <div className="aureo-mono-label mb-6">PROTOCOL · CHOOSE YOUR PATH</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {paths.map((p) => (
            <a
              key={p.label}
              href={p.href}
              className="group border border-white/10 bg-gradient-to-br from-[rgba(14,14,14,0.8)] to-[rgba(5,5,5,0.6)] p-5 transition hover:border-[#C5A67C]/35 hover:bg-[rgba(197,166,124,0.04)]"
            >
              <div className="aureo-mono-label mb-3" style={{ color: '#C5A67C' }}>{p.label}</div>
              <div className="aureo-display text-2xl mb-2" style={{ color: '#EAE4D8' }}>{p.title}</div>
              <p className="text-sm mb-4" style={{ color: 'rgba(234, 228, 216, 0.65)', lineHeight: 1.5 }}>{p.body}</p>
              <div className="text-xs uppercase tracking-[0.18em] font-medium transition group-hover:translate-x-0.5" style={{ color: '#C5A67C' }}>
                {p.cta} →
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* ─── Quickstart ─── */}
      <section className="max-w-6xl mx-auto px-6 mb-20">
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
      <section id="ai-skill" className="max-w-6xl mx-auto px-6 mb-20 scroll-mt-20">
        <div className="aureo-mono-label mb-3">PROTOCOL · AI AGENT INTEGRATION</div>
        <p className="text-sm mb-6 max-w-3xl" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.6 }}>
          The fastest way to ship: paste one line into your AI agent and let it wire ArcLayer into
          your existing app. The skill file is fetched live, so it stays in sync with the protocol.
        </p>

        {/* Primary one-liner card */}
        <div className="border border-[#C5A67C]/30 bg-gradient-to-br from-[rgba(197,166,124,0.05)] to-[rgba(5,5,5,0.6)] mb-6">
          <div className="px-5 py-4 border-b border-white/8">
            <div className="aureo-mono-label mb-1" style={{ color: '#C5A67C' }}>PASTE THIS TO YOUR AI</div>
            <h3 className="aureo-display text-xl md:text-2xl" style={{ color: '#EAE4D8' }}>
              Drop into Codex, Cursor, Claude, Kiro, Hermes, OpenClaw, and all other agents
            </h3>
          </div>
          <div className="p-5">
            <pre
              className="text-sm p-4 mb-3 overflow-x-auto border border-[#C5A67C]/20 bg-black/50 select-all"
              style={{ color: '#EAE4D8', fontFamily: 'var(--font-mono)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
            >
              <span style={{ color: 'rgba(234,228,216,0.85)' }}>Read this skill and use it to integrate ArcLayer into my app:</span>{'\n'}
              <span style={{ color: '#C5A67C' }}>{SKILL_RAW_URL}</span>
            </pre>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={ONELINER_PROMPT} label="Copy One-Liner" />
              <CopyButton text={SKILL_RAW_URL} label="Copy URL only" />
              <a
                href={SKILL_RAW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(234,228,216,0.7)] transition hover:border-white/20 hover:text-[#EAE4D8]"
              >
                View Raw ↗
              </a>
              <a
                href={SKILL_BLOB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(234,228,216,0.7)] transition hover:border-white/20 hover:text-[#EAE4D8]"
              >
                View on GitHub ↗
              </a>
            </div>
          </div>
        </div>

        {/* For deployers card */}
        <div className="border border-[#C5A67C]/20 bg-gradient-to-br from-[rgba(197,166,124,0.06)] to-[rgba(5,5,5,0.5)] p-5 mb-6">
          <div className="aureo-mono-label mb-2" style={{ color: '#C5A67C' }}>FOR DEPLOYERS</div>
          <p className="text-sm mb-4" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.6 }}>
            Deploying an agent, API, or AI service? Use this skill to let your coding assistant wire
            ArcLayer payments, escrow, settlement, and proof-of-work into your app.
          </p>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={ONELINER_PROMPT} label="Copy AI Skill" />
            <a href="#sdk-examples" className="border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(234,228,216,0.7)] transition hover:border-white/20 hover:text-[#EAE4D8]">
              View SDK Examples ↓
            </a>
            <Link href="/protocol" className="border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(234,228,216,0.7)] transition hover:border-white/20 hover:text-[#EAE4D8]">
              Open Console ↗
            </Link>
          </div>
        </div>

        {/* Expandable full prompt */}
        <details className="border border-white/10 bg-gradient-to-br from-[rgba(14,14,14,0.8)] to-[rgba(5,5,5,0.6)] group">
          <summary className="px-5 py-4 cursor-pointer flex items-center justify-between gap-3 hover:bg-white/[0.02] transition">
            <span className="aureo-mono-label" style={{ color: 'rgba(234, 228, 216, 0.8)' }}>
              ALTERNATIVE · Inline full prompt (if your AI cannot fetch URLs)
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] transition group-open:rotate-180" style={{ color: '#C5A67C' }}>▾</span>
          </summary>
          <div className="border-t border-white/8 px-5 py-4">
            <div className="flex items-center justify-end mb-3">
              <CopyButton text={aiSkillPrompt} label="Copy Full Prompt" />
            </div>
            <pre
              className="text-xs p-4 overflow-auto border border-white/5 bg-black/40"
              style={{ color: '#C5A67C', fontFamily: 'var(--font-mono)', lineHeight: 1.55, maxHeight: 420 }}
            >{aiSkillPrompt}</pre>
          </div>
        </details>
      </section>

      {/* ─── Network & Contracts ─── */}
      <section id="network" className="max-w-6xl mx-auto px-6 mb-20 scroll-mt-20">
        <div className="aureo-mono-label mb-6">PROTOCOL · NETWORK &amp; CONTRACTS</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Network info */}
          <div className="border border-white/10 bg-gradient-to-br from-[rgba(14,14,14,0.8)] to-[rgba(5,5,5,0.6)]">
            <div className="px-5 py-3 border-b border-white/8">
              <span className="aureo-mono-label" style={{ color: '#C5A67C' }}>NETWORK</span>
            </div>
            <div className="divide-y divide-white/5">
              {networkInfo.map((n) => (
                <div key={n.label} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-wider" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>{n.label}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs truncate" style={{ color: '#EAE4D8' }}>{n.value}</span>
                    {n.copy && <CopyButton text={n.value} label="Copy" />}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Contract addresses */}
          <div className="border border-white/10 bg-gradient-to-br from-[rgba(14,14,14,0.8)] to-[rgba(5,5,5,0.6)]">
            <div className="px-5 py-3 border-b border-white/8">
              <span className="aureo-mono-label" style={{ color: '#C5A67C' }}>CONTRACTS</span>
            </div>
            <div className="divide-y divide-white/5">
              {contracts.map((c) => (
                <div key={c.label} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-wider" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>{c.label}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs truncate" style={{ color: '#EAE4D8' }}>{c.address}</span>
                    <CopyButton text={c.address} label="Copy" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Recommended Integration Order ─── */}
      <section className="max-w-6xl mx-auto px-6 mb-20">
        <div className="aureo-mono-label mb-6">PROTOCOL · RECOMMENDED INTEGRATION ORDER</div>
        <div className="border border-white/10 bg-gradient-to-br from-[rgba(14,14,14,0.8)] to-[rgba(5,5,5,0.6)]">
          <ol className="divide-y divide-white/5">
            {integrationOrder.map((item, i) => (
              <li key={i} className="px-5 py-3 flex items-start gap-4 transition hover:bg-[rgba(197,166,124,0.03)]">
                <span className="font-mono text-xs flex-shrink-0 mt-0.5" style={{ color: '#C5A67C' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-sm" style={{ color: 'rgba(234, 228, 216, 0.85)', lineHeight: 1.55 }}>{item}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ─── REST API ─── */}
      <section id="rest-api" className="max-w-6xl mx-auto px-6 mb-20 scroll-mt-20">
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
      <section id="sdk-examples" className="max-w-6xl mx-auto px-6 mb-20 scroll-mt-20">
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
