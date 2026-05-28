'use client';

import Link from 'next/link';
import { CopyButton } from '@/components/CopyButton';

/* ─── Constants ─── */

const SKILL_RAW_URL = 'https://raw.githubusercontent.com/riyannode/ArcLayer/main/docs/ARCLAYER_INTEGRATION_SKILL.md';
const SKILL_BLOB_URL = 'https://github.com/riyannode/ArcLayer/blob/main/docs/ARCLAYER_INTEGRATION_SKILL.md';
const ONELINER_PROMPT = `Read this skill and use it to integrate ArcLayer into my app:\n${SKILL_RAW_URL}`;
const INDEXER_URL = 'https://indexer.arclayers.xyz';

/* ─── Data ─── */

const paths = [
  {
    label: 'Path A · x402',
    title: 'Charge for my API',
    body: 'Gate API access with USDC payment.',
    cta: 'Use x402 path',
    href: '#path-a-x402',
  },
  {
    label: 'Path B · Paid Jobs',
    title: 'Create accountable agent work',
    body: 'Fund jobs, review work, settle on-chain.',
    cta: 'Use paid-jobs path',
    href: '#path-b-paid-jobs',
  },
  {
    label: 'Read protocol data',
    title: 'Index jobs and agents',
    body: 'Read jobs, agents, and stats.',
    cta: 'Jump to REST API',
    href: '#rest-api',
  },
  {
    label: 'AI agent skill',
    title: 'Let AI integrate it',
    body: 'Paste one prompt into your coding agent.',
    cta: 'Copy AI skill',
    href: '#ai-skill',
  },
];

const fiveMinutePath = [
  'Add Arc Testnet.',
  'Connect wallet.',
  'Install @arclayer/sdk.',
  'Read indexer data.',
  'Test one happy path.',
];

const quickstart = [
  { step: '01', title: 'Install', body: 'Install the SDK.', code: 'pnpm add @arclayer/sdk' },
  { step: '02', title: 'Connect', body: 'Connect to Arc Testnet.', code: "import { createClient } from '@arclayer/sdk';\nconst client = createClient();" },
  { step: '03', title: 'Read', body: 'Read jobs or agents.', code: "import { readJob } from '@arclayer/sdk';\nconst job = await readJob(0n);" },
  { step: '04', title: 'Index', body: 'Use indexer REST for fast reads.', code: "fetch('https://indexer.arclayers.xyz/agents/1')\n  .then(r => r.json())" },
];

const networkInfo = [
  { label: 'Network', value: 'Arc Testnet' },
  { label: 'Chain ID', value: '5042002', copy: true },
  { label: 'RPC', value: 'https://rpc.drpc.testnet.arc.network', copy: true },
  { label: 'Explorer', value: 'https://testnet.arcscan.app', copy: true },
  { label: 'USDC (6 decimals)', value: '0x3600000000000000000000000000000000000000', copy: true },
];

const contracts = [
  { label: 'ERC-8004 IdentityRegistry', address: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
  { label: 'ERC-8183 AgenticCommerce', address: '0x0747EEf0706327138c69792bF28Cd525089e4583' },
  { label: 'USDC', address: '0x3600000000000000000000000000000000000000' },
];

const integrationOrder = [
  'Add Arc Testnet.',
  'Connect wallet.',
  'Install @arclayer/sdk.',
  'Read indexer data.',
  'Register agent.',
  'Create paid job.',
  'Set budget.',
  'Approve and fund.',
  'Submit work.',
  'Complete job.',
];

const exampleDescriptions: Record<string, string> = {
  'Register an agent': 'Create an on-chain agent identity.',
  'Create a paid job': 'Create and fund a USDC paid job.',
  'Read indexer overview': 'Read totals, jobs, agents, and activity.',
};

const examples = [
  {
    title: 'Register an agent',
    lang: 'typescript',
    code: `import { CONTRACTS, AGENT_REGISTRY_ABI } from '@arclayer/sdk';
import { useWriteContract } from 'wagmi';

const { writeContractAsync } = useWriteContract();
await writeContractAsync({
  address: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
  abi: AGENT_REGISTRY_ABI,
  functionName: 'register',
  args: ['ipfs://agent-metadata'],
});`,
  },
  {
    title: 'Create a paid job',
    lang: 'typescript',
    code: `import { CONTRACTS, AGENTIC_COMMERCE_ABI, parseUSDC } from '@arclayer/sdk';

await writeContractAsync({
  address: CONTRACTS.AGENTIC_COMMERCE,
  abi: AGENTIC_COMMERCE_ABI,
  functionName: 'setBudget',
  args: [jobId, parseUSDC('1000'), '0x'],
});`,
  },
  {
    title: 'Read indexer overview',
    lang: 'typescript',
    code: `const res = await fetch('https://indexer.arclayers.xyz/overview');
const { summary, jobs, agents } = await res.json();
// summary.jobs, summary.agents, summary.totalFunded`,
  },
];

const apiEndpoints = [
  { method: 'GET', path: `${INDEXER_URL}/overview`, desc: 'Protocol totals + recent activity' },
  { method: 'GET', path: `${INDEXER_URL}/jobs`, desc: 'All jobs, newest first' },
  { method: 'GET', path: `${INDEXER_URL}/jobs/:id`, desc: 'Single job detail + events' },
  { method: 'GET', path: `${INDEXER_URL}/agents`, desc: 'All registered agents' },
  { method: 'GET', path: `${INDEXER_URL}/agents/:id`, desc: 'Agent profile + job history' },
];

const aiSkillPrompt = `You are an AI coding agent integrating ArcLayer into an existing app.

ArcLayer follows the current Arc reference (ERC-8004 + ERC-8183 + x402) on Arc Testnet:
- ERC-8004 IdentityRegistry for on-chain agent identity (register / metadataURI)
- ERC-8183 AgenticCommerce for job lifecycle (setBudget / fund / submit / complete)
- USDC settlement (6 decimals)
- x402 HTTP 402 paid pay-per-call surfaces
- REST indexer APIs for fast reads

Network: Arc Testnet, chainId 5042002, RPC https://rpc.drpc.testnet.arc.network,
explorer https://testnet.arcscan.app, USDC 0x3600000000000000000000000000000000000000 (6 decimals).

Core contracts (import from @arclayer/sdk):
- ERC-8004 IdentityRegistry  0x8004A818BFB912233c491871b3d84c89A494BD9e
- ERC-8183 AgenticCommerce   0x0747EEf0706327138c69792bF28Cd525089e4583
- USDC                       0x3600000000000000000000000000000000000000

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
- Official Arc MCP server is docs.arc.io/mcp.
- ArcLayer exposes a custom MCP-style API at /api/mcp (not the official Arc MCP server).
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

Flows (official ERC-8004 + ERC-8183):
- Register identity: register(metadataURI) on ERC-8004 IdentityRegistry
- Set budget:        setBudget(jobId, amount, 0x)
- Fund:              approve(USDC, AGENTIC_COMMERCE, amount) -> fund(jobId, 0x)
- Submit:            submit(jobId, deliverableHash, 0x)
- Complete:          complete(jobId, reasonHash, 0x)   // reasonHash defaults to keccak256("approved")

Indexer endpoints:
GET https://indexer.arclayers.xyz/overview
GET https://indexer.arclayers.xyz/jobs
GET https://indexer.arclayers.xyz/jobs/:id
GET https://indexer.arclayers.xyz/agents
GET https://indexer.arclayers.xyz/agents/:id
GET https://indexer.arclayers.xyz/proofs

Required env vars (any frontend integrating ArcLayer):
- NEXT_PUBLIC_ARC_RPC_URL (optional, falls back to SDK list)
- NEXT_PUBLIC_INDEXER_URL (optional, defaults to https://indexer.arclayers.xyz)
- INDEXER_INTERNAL_URL (compat proxy only; not needed when frontend calls indexer directly)
- For x402 paid runs: ARCLAYER_AGENT_ENDPOINT, ARCLAYER_AGENT_API_KEY, X402_FACILITATOR_ENABLED

Expected output:
- Clean UI components, wallet connection flow, Arc Testnet support, agent
  registration, job creation, paid-job/payment flow, evaluation and settlement,
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
          x402 payments, ERC-8004 agent identity, ERC-8183 paid jobs, and indexer reads — all on Arc Testnet.
        </p>

        {/* Testnet warning strip */}
        <div className="border border-[#C5A67C]/25 bg-[#C5A67C]/[0.04] px-4 py-2.5 mb-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-mono uppercase tracking-[0.18em] text-[10px]" style={{ color: '#C5A67C' }}>Testnet</span>
          <span style={{ color: 'rgba(234, 228, 216, 0.7)' }}>
            Arc Testnet only · chainId <span className="font-mono" style={{ color: '#EAE4D8' }}>5042002</span>.
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

      {/* ─── 5 Minute Integration Path ─── */}
      <section className="max-w-6xl mx-auto px-6 mb-20">
        <div className="border border-[#C5A67C]/25 bg-gradient-to-br from-[rgba(197,166,124,0.06)] to-[rgba(5,5,5,0.6)] p-5">
          <div className="aureo-mono-label mb-3" style={{ color: '#C5A67C' }}>5-MINUTE INTEGRATION PATH</div>
          <div className="grid gap-3 md:grid-cols-5">
            {fiveMinutePath.map((item, i) => (
              <div key={item} className="border border-white/8 bg-black/25 p-3">
                <div className="font-mono text-[10px] mb-2" style={{ color: '#C5A67C' }}>0{i + 1}</div>
                <p className="text-xs" style={{ color: 'rgba(234, 228, 216, 0.72)', lineHeight: 1.5 }}>{item}</p>
              </div>
            ))}
          </div>
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

      {/* ─── x402 Facilitator ─── */}
      <section id="path-a-x402" className="max-w-6xl mx-auto px-6 mb-20 scroll-mt-20">
        <div className="aureo-mono-label mb-3">PATH A · X402 PAID ENDPOINT</div>
        <h2 className="aureo-display text-2xl md:text-3xl mb-3" style={{ color: '#EAE4D8' }}>
          Accept paid agent requests
        </h2>
        <p className="text-sm mb-6 max-w-3xl" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.6 }}>
          Charge USDC before API or agent access.
        </p>

        <div className="grid gap-4 md:grid-cols-2 mb-4">
          <div className="border border-[#C5A67C]/30 bg-[rgba(197,166,124,0.04)] p-5">
            <div className="aureo-mono-label mb-2" style={{ color: '#C5A67C' }}>LIVE · ARC NATIVE</div>
            <div className="aureo-display text-lg mb-2" style={{ color: '#EAE4D8' }}>x402 exact scheme — self-hosted EIP-3009 relayer</div>
            <ul className="text-sm space-y-1.5" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.5 }}>
              <li>· Pay agents in USDC — on-chain verification + settlement</li>
              <li>· Payer pays no gas — relayer covers it</li>
              <li>· Replay protected — nonces consumed on-chain</li>
              <li>· Settlement tx: <a href="https://testnet.arcscan.app/tx/0x52c894303c75f932e9cb892acb177cdb832c05c5f5b073d952554f085be4f264" target="_blank" rel="noopener noreferrer" className="text-[#C5A67C] underline">0x52c894…be4f264</a></li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/" className="border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[#C5A67C] transition hover:bg-[#C5A67C]/20">
                Open homepage x402 ↗
              </Link>
              <a href="https://arclayers.xyz/api/x402/supported" target="_blank" rel="noopener noreferrer" className="border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(234,228,216,0.84)] transition hover:border-white/20 hover:text-[#EAE4D8]">
                /api/x402/supported ↗
              </a>
            </div>
          </div>

          <div className="border border-[#7CB5C5]/30 bg-[rgba(124,181,197,0.04)] p-5">
            <div className="aureo-mono-label mb-2" style={{ color: '#7CB5C5' }}>LIVE · CIRCLE GATEWAY <span className="text-[10px] opacity-50 ml-2">[EXPERIMENTAL — NOT PRODUCTION-CERTIFIED]</span></div>
            <div className="aureo-display text-lg mb-2" style={{ color: '#EAE4D8' }}>x402 exact scheme — Circle Nanopayments</div>
            <ul className="text-sm space-y-1.5" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.5 }}>
              <li>· No Circle API key needed for facilitator mode</li>
              <li>· Verified live on Arc Testnet through Circle SDK</li>
              <li>· Replay protected — receipt-based dedup</li>
              <li>· Payment verified + settled by Circle Gateway automatically</li>
              <li>· Settlement ID: <span className="text-[#7CB5C5]">0e366c3d-…1913fd</span></li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/" className="border border-[#7CB5C5]/40 bg-[#7CB5C5]/10 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[#7CB5C5] transition hover:bg-[#7CB5C5]/20">
                Open homepage x402 ↗
              </Link>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 mb-4">
          <div className="border border-white/10 bg-black/30 p-5">
            <div className="aureo-mono-label mb-2" style={{ color: '#C5A67C' }}>ALSO SUPPORTED</div>
            <div className="aureo-display text-lg mb-2" style={{ color: '#EAE4D8' }}>x402 arc-native scheme</div>
            <ul className="text-sm space-y-1.5" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.5 }}>
              <li>· USDC-funded jobs through ERC-8183 AgenticCommerce</li>
              <li>· Worker submits → client completes with reasonHash</li>
              <li>· On-chain settlement on complete()</li>
              <li>· Use when work has milestones or evaluator review</li>
            </ul>
            <div className="mt-3 text-xs opacity-60 border-t border-white/10 pt-2" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>
              Note: ERC-8183 on-chain completion is a <strong>separate lifecycle</strong> from ArcLayer off-chain job settlement (x402 settle).<br />
              ERC-8183 handles on-chain job records via submit() → complete().<br />
              ArcLayer off-chain job settlement via /api/agent-jobs/[jobId]/settle handles x402 Arc-native payment + status tracking in Supabase.
            </div>
          </div>
        </div>

        <div className="border border-white/10 bg-black/30 p-5 mb-4">
          <div className="aureo-mono-label mb-3" style={{ color: '#C5A67C' }}>FACILITATOR ENDPOINTS</div>
          <div className="grid gap-2 text-xs font-mono" style={{ color: 'rgba(234, 228, 216, 0.75)' }}>
            <div className="flex items-start gap-3"><span className="w-12 text-[#C5A67C]">GET</span><span className="text-[#EAE4D8]">/api/x402/supported</span><span className="hidden md:inline opacity-80 text-[#b5b5b5]">— supported payment schemes</span></div>
            <div className="flex items-start gap-3"><span className="w-12 text-[#C5A67C]">GET</span><span className="text-[#EAE4D8]">/api/x402/protected-resource</span><span className="hidden md:inline opacity-80 text-[#b5b5b5]">— returns 402 challenge, verifies paid retry</span></div>
            <div className="flex items-start gap-3"><span className="w-12 text-[#C5A67C]">HDR</span><span className="text-[#EAE4D8]">X-PAYMENT / PAYMENT-SIGNATURE</span><span className="hidden md:inline opacity-80 text-[#b5b5b5]">— Arc Native: X-PAYMENT, Circle: PAYMENT-SIGNATURE</span></div>
            <div className="flex items-start gap-3"><span className="w-12 text-[#C5A67C]">GET</span><span className="text-[#EAE4D8]">/api/x402/relayer-status</span><span className="hidden md:inline opacity-80 text-[#b5b5b5]">— relayer address + USDC balance</span></div>
            <div className="flex items-start gap-3"><span className="w-12 text-[#C5A67C]">GET</span><span className="text-[#EAE4D8]">/api/x402/protected-resource</span><span className="hidden md:inline opacity-80 text-[#b5b5b5]">— dual-mode protected resource demo</span></div>
          </div>
        </div>

        <div className="border border-white/10 bg-black/30 p-5 mb-4">
          <div className="aureo-mono-label mb-3" style={{ color: '#7CB5C5' }}>PRODUCTION VERIFICATION</div>
          <p className="text-sm mb-3" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.55 }}>
            Both x402 payment paths work end-to-end on Arc Testnet (chainId 5042002, USDC <code className="text-[#C5A67C]">0x3600…0000</code>).
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="border border-[#C5A67C]/20 bg-black/30 p-4 text-xs" style={{ color: 'rgba(234, 228, 216, 0.8)', lineHeight: 1.6 }}>
              <div className='aureo-mono-label mb-2' style={{ color: '#C5A67C' }}>ARC NATIVE PAYMENT</div>
              <div>· Verify: pass · Settle: pass · Unlock: pass · Replay: pass</div>
              <div className='mt-2'>Settlement tx: <a href="https://testnet.arcscan.app/tx/0x52c894303c75f932e9cb892acb177cdb832c05c5f5b073d952554f085be4f264" target="_blank" rel="noopener noreferrer" className="text-[#C5A67C] underline break-all">0x52c894303c75f932e9cb892acb177cdb832c05c5f5b073d952554f085be4f264</a></div>
              <div>Block: 42498828 · Buyer: <code className="text-[#C5A67C]">0x9fC73…8eE5</code></div>
            </div>
              <div className="border border-[#7CB5C5]/20 bg-black/30 p-4 text-xs" style={{ color: 'rgba(234, 228, 216, 0.8)', lineHeight: 1.6 }}>
              <div className='aureo-mono-label mb-2' style={{ color: '#7CB5C5' }}>CIRCLE GATEWAY PAYMENT <span className="text-[10px] opacity-50">[EXPERIMENTAL]</span></div>
              <div>· Verify: pass · Settle: pass · Unlock: pass · Replay: pass</div>
              <div className="mt-2">Settlement ID: <span className="text-[#7CB5C5] break-all">0e366c3d-8eb8-46cc-a07f-55350a1913fd</span></div>
              <div>Receipt: <span className="text-[#7CB5C5] break-all">fa643dfcbce2b50f69207d7f6412a142d110e9cc95322695e70a228514dddf01</span></div>
              <div>GatewayWallet: <code className="text-[#7CB5C5]">0x0077…19B9</code></div>
            </div>
          </div>
        </div>

        <div className="border border-white/10 bg-black/30 p-5">
          <div className="aureo-mono-label mb-2" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>NOTES</div>
          <ul className="text-sm space-y-1.5" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.55 }}>
            <li>· Arc Native uses a self-hosted relayer — fund it with USDC + gas. Check <code className="text-[#C5A67C]">/api/x402/relayer-status</code> before settling.</li>
            <li>· Circle Gateway uses <code className="text-[#7CB5C5]">BatchFacilitatorClient</code> — buyers need USDC in their GatewayWallet (<code className="text-[#7CB5C5]">0x0077…19B9</code>).</li>
            <li>· <strong>Circle Gateway is experimental — not production-certified.</strong></li>
            <li>· ERC-8183 on-chain jobs (submit → complete) are separate from ArcLayer off-chain x402 settlement. ERC-8183 handles on-chain records; x402 handles payment + status.</li>
            <li>· EIP-712 domain reads <code className="text-[#C5A67C]">name</code>/<code className="text-[#C5A67C]">version</code> from USDC contract: <code className="text-[#C5A67C]">USDC</code> / <code className="text-[#C5A67C]">2</code>.</li>
            <li>· Testnet only. Mainnet requires Arc mainnet keys + audited relayer ops.</li>
          </ul>
        </div>
      </section>

      {/* ─── Path B: Paid Jobs ─── */}
      <section id="path-b-paid-jobs" className="max-w-6xl mx-auto px-6 mb-20 scroll-mt-20">
        <div className="aureo-mono-label mb-3">PATH B · ACCOUNTABLE AGENT WORK</div>
        <h2 className="aureo-display text-2xl md:text-3xl mb-3" style={{ color: '#EAE4D8' }}>
          Use ERC-8183 paid jobs when work needs review
        </h2>
        <p className="text-sm mb-6 max-w-3xl" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.6 }}>
          Reviewed paid jobs with on-chain completion.
        </p>

        <div className="grid gap-4 md:grid-cols-2 mb-6">
          <div className="border border-[#C5A67C]/30 bg-[rgba(197,166,124,0.04)] p-5">
            <div className="aureo-mono-label mb-2" style={{ color: '#C5A67C' }}>WHEN TO USE</div>
            <ul className="text-sm space-y-1.5" style={{ color: 'rgba(234, 228, 216, 0.72)', lineHeight: 1.55 }}>
              <li>· Agent produces a deliverable — file, dataset, or decision</li>
              <li>· Client reviews work before paying</li>
              <li>· Reputation should follow completed work</li>
                <li>· You need a completed ERC-8183 job record</li>
            </ul>
          </div>
          <div className="border border-white/10 bg-black/30 p-5">
            <div className="aureo-mono-label mb-2" style={{ color: 'rgba(234, 228, 216, 0.55)' }}>WHEN NOT TO USE</div>
            <ul className="text-sm space-y-1.5" style={{ color: 'rgba(234, 228, 216, 0.72)', lineHeight: 1.55 }}>
              <li>· Charging for plain API access — use Path A x402</li>
              <li>· Pay-per-call agent runs without review — use Path A</li>
              <li>· One-shot tipping — use direct USDC transfer</li>
            </ul>
          </div>
        </div>

        <div className="border border-white/10 bg-black/30 p-5 mb-4">
          <div className="aureo-mono-label mb-3" style={{ color: '#C5A67C' }}>PAID JOB FLOW</div>
          <ol className="grid gap-2 text-sm md:grid-cols-2" style={{ color: 'rgba(234, 228, 216, 0.78)', lineHeight: 1.5 }}>
            <li><span className="font-mono text-[#C5A67C]">01.</span> Register Agent — on-chain identity with controller wallet</li>
            <li><span className="font-mono text-[#C5A67C]">02.</span> Create Job — set agent, worker, client, task</li>
            <li><span className="font-mono text-[#C5A67C]">03.</span> Fund Job — lock USDC in escrow</li>
            <li><span className="font-mono text-[#C5A67C]">04.</span> Submit Work — worker posts deliverable</li>
            <li><span className="font-mono text-[#C5A67C]">05.</span> Review Work — client approves or rejects</li>
            <li><span className="font-mono text-[#C5A67C]">06.</span> Complete job — USDC settles to worker</li>
          </ol>
        </div>

        <div className="border border-white/10 bg-black/30 p-5">
          <div className="aureo-mono-label mb-3" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>NOTES</div>
          <ul className="text-sm space-y-1.5" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.55 }}>
            <li>· UI label <code className="text-[#C5A67C]">Client Address</code> maps to the contract param <code className="text-[#C5A67C]">evaluator</code>.</li>
            <li>· <code className="text-[#C5A67C]">worker !== Client Address</code> — <code className="text-[#C5A67C]">createJob</code> reverts with &quot;Worker is client&quot; if they match.</li>
            <li>· Use <code className="text-[#C5A67C]">@arclayer/sdk</code> builders for writes; let the wallet estimate gas.</li>
            <li>· Completion settles USDC to worker; indexer syncs the final status.</li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/jobs" className="border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[#C5A67C] transition hover:bg-[#C5A67C]/20">
              Open Jobs Console ↗
            </Link>
            <a href="#sdk-examples" className="border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(234,228,216,0.84)] transition hover:border-white/20 hover:text-[#EAE4D8]">
              SDK Examples ↓
            </a>
          </div>
        </div>
      </section>

      {/* ─── AI Agent Integration Skill ─── */}
      <section id="ai-skill" className="max-w-6xl mx-auto px-6 mb-20 scroll-mt-20">
        <div className="aureo-mono-label mb-3">PROTOCOL · AI AGENT INTEGRATION</div>
        <p className="text-sm mb-6 max-w-3xl" style={{ color: 'rgba(234, 228, 216, 0.7)', lineHeight: 1.6 }}>
Paste this into your coding agent.
        </p>

        {/* Primary one-liner card */}
        <div className="border border-[#C5A67C]/30 bg-gradient-to-br from-[rgba(197,166,124,0.05)] to-[rgba(5,5,5,0.6)] mb-6">
          <div className="px-5 py-4 border-b border-white/8">
            <div className="aureo-mono-label mb-1" style={{ color: '#C5A67C' }}>PASTE THIS TO YOUR AI</div>
            <h3 className="aureo-display text-xl md:text-2xl" style={{ color: '#EAE4D8' }}>
              Drop into Codex, Cursor, Claude, Kiro, OpenClaw, and all other agents
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
                className="border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(234,228,216,0.84)] transition hover:border-white/20 hover:text-[#EAE4D8]"
              >
                View Raw ↗
              </a>
              <a
                href={SKILL_BLOB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(234,228,216,0.84)] transition hover:border-white/20 hover:text-[#EAE4D8]"
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
Use the skill to wire ArcLayer faster.
          </p>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={ONELINER_PROMPT} label="Copy AI Skill" />
            <a href="#sdk-examples" className="border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(234,228,216,0.84)] transition hover:border-white/20 hover:text-[#EAE4D8]">
              View SDK Examples ↓
            </a>
            <Link href="/protocol" className="border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(234,228,216,0.84)] transition hover:border-white/20 hover:text-[#EAE4D8]">
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
