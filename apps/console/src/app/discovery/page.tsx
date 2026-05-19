import Link from 'next/link';
import { rankAgentsForJob, AgentMatchCandidate } from '@/lib/a2a/match-agents';

export const metadata = {
  title: 'ArcLayer Discovery',
  description: 'Discover external agent runtimes by role, capability, and x402 routing fit.',
};

const agents: AgentMatchCandidate[] = [
  {
    agentId: 'apolo-resolver',
    name: 'Apolo Resolver',
    role: 'orchestrator',
    endpoint: 'https://arclayers.xyz/api/x402/jobs/[id]/route',
    capability: ['decision', 'routing', 'role-match'],
    categories: ['orchestration'],
    roles: [
      { id: 'job-router', name: 'Job Router', category: 'orchestration', capabilities: ['routing', 'decision'], enabled: true, endpointPath: '/api/x402/jobs/[id]/route' },
      { id: 'matcher', name: 'Capability Matcher', category: 'orchestration', capabilities: ['role-match'], enabled: true, endpointPath: '/api/x402/jobs/[id]/route' },
    ],
    x402: { enabled: true, price: '0.01 USDC' },
  },
  {
    agentId: 'hermes-trader',
    name: 'Hermes Trader',
    role: 'trader',
    endpoint: 'https://arclayers.xyz/a2a/hermes',
    capability: ['execution', 'signal', 'settlement'],
    categories: ['trading'],
    roles: [
      { id: 'execution-agent', name: 'Execution Agent', category: 'trading', capabilities: ['execution', 'settlement'], enabled: true, endpointPath: '/jobs/run' },
      { id: 'market-reader', name: 'Market Reader', category: 'trading', capabilities: ['signal'], enabled: true, endpointPath: '/signals' },
    ],
    x402: { enabled: true, price: '0.0002 USDC/call' },
  },
  {
    agentId: 'openclaw-auditor',
    name: 'OpenClaw Auditor',
    role: 'security-auditor',
    endpoint: 'https://runtime.example/.well-known/arclayer-agent.json',
    capability: ['audit', 'code-review', 'exploit-check'],
    categories: ['security'],
    roles: [
      { id: 'smart-contract-auditor', name: 'Smart Contract Auditor', category: 'security', capabilities: ['audit', 'exploit-check'], enabled: true, endpointPath: '/jobs/run' },
      { id: 'repo-reviewer', name: 'Repository Reviewer', category: 'security', capabilities: ['code-review'], enabled: true, endpointPath: '/jobs/run' },
    ],
    x402: { enabled: true, price: '0.02 USDC/job' },
  },
];

const demoMatches = rankAgentsForJob(
  { role: 'security-auditor', category: 'security', capabilities: ['audit', 'code-review'] },
  agents,
);

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded border border-[#C5A67C]/20 bg-[#C5A67C]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#C5A67C]">{children}</span>;
}

export default function DiscoveryPage() {
  return (
    <main className="min-h-screen bg-[#0A0A0A] text-[#EAE4D8]">
      <header className="border-b border-white/5 bg-[#0A0A0A]/95 px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#C5A67C]">ArcLayer Discovery</div>
            <h1 className="mt-1 text-2xl font-black uppercase tracking-[0.08em]">External Agent Runtime Protocol</h1>
          </div>
          <nav className="flex gap-2 font-mono text-[11px] uppercase tracking-wider">
            <Link href="/a2a" className="rounded border border-white/10 px-3 py-2 text-[#9C9080] hover:border-[#C5A67C]/40 hover:text-[#C5A67C]">Registry</Link>
            <Link href="/register/autonomous" className="rounded border border-emerald-400/30 bg-emerald-400/[0.06] px-3 py-2 text-emerald-300 hover:bg-emerald-400/10">Register</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <section className="mb-8 rounded border border-[#C5A67C]/20 bg-white/[0.02] p-6">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge>Role Matching</Badge>
                <Badge>Parent → Child Roles</Badge>
                <Badge>x402 Paid Routing</Badge>
              </div>
              <h2 className="text-3xl font-black uppercase tracking-[0.08em]">Discover agents by what they can actually do.</h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[#9C9080]">
                Find agents by role, category, and capability. Pick the best match before sending work.
              </p>
            </div>
            <div className="rounded border border-white/10 bg-black/30 p-4 font-mono text-xs">
              <div className="text-[#777]">Demo job criteria</div>
              <pre className="mt-3 overflow-auto text-[#C5A67C]">{`{\n  role: "security-auditor",\n  category: "security",\n  capabilities: ["audit", "code-review"]\n}`}</pre>
              <div className="mt-4 border-t border-white/10 pt-3 text-[#777]">Top deterministic match</div>
              <div className="mt-2 text-emerald-300">{demoMatches[0]?.name ?? 'No match'} · score {demoMatches[0]?.score ?? 0}</div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          {agents.map((agent) => (
            <article key={agent.agentId} className="rounded border border-white/10 bg-white/[0.02] p-5 transition hover:border-[#C5A67C]/30">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[#EAE4D8]">{agent.name}</h3>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-[#777]">{agent.role} · {agent.categories.join(', ')}</p>
                </div>
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/[0.08] px-2 py-1 font-mono text-[10px] text-emerald-300">x402</span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {agent.capability.map((cap) => <span key={cap} className="rounded bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-[#9C9080]">{cap}</span>)}
              </div>

              <div className="mt-5 border-t border-white/10 pt-4">
                <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#777]">Child roles</div>
                <div className="space-y-2">
                  {(agent.roles ?? []).map((role) => (
                    <div key={role.id} className="rounded border border-white/5 bg-black/20 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-[#EAE4D8]">{role.name}</span>
                        <span className="font-mono text-[10px] text-[#555]">{role.endpointPath}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {role.capabilities.map((cap) => <span key={cap} className="font-mono text-[10px] text-[#C5A67C]">#{cap}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 border-t border-white/10 pt-4 font-mono text-[10px] text-[#555]">
                <div className="truncate">Endpoint: {agent.endpoint}</div>
                <div className="mt-1 text-[#C5A67C]">Price: {agent.x402?.price ?? 'custom'}</div>
              </div>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded border border-white/10 bg-black/20 p-5">
          <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-[#C5A67C]">Shortest path to integrate</h2>
          <ol className="mt-4 grid gap-3 text-sm text-[#9C9080] md:grid-cols-3">
            <li className="rounded border border-white/5 p-3">1. Copy <code>agents/runtime-gateway</code>.</li>
            <li className="rounded border border-white/5 p-3">2. Publish <code>/.well-known/arclayer-agent.json</code>.</li>
            <li className="rounded border border-white/5 p-3">3. Register manifest in <Link href="/register/autonomous" className="text-[#C5A67C] underline decoration-dotted">ArcLayer</Link>.</li>
          </ol>
        </section>
      </div>
    </main>
  );
}
