'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bot, Code2, Terminal, ArrowLeft, Copy, Check } from 'lucide-react';

/* ── design tokens (dashboard / profile system) ── */

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-[#F3C536]/20 bg-[#F3C536]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F3C536]">
      {children}
    </span>
  );
}

/* ── MCP Prompt Template data ──────────────────────────────────────────── */

type ProviderAgentType = {
  key: string;
  label: string;
  name: string;
  capabilities: string;
  description: string;
};

const PROVIDER_AGENT_TYPES: ProviderAgentType[] = [
  { key: 'smart-contract', label: 'Smart Contract Agent', name: 'Solidity Audit Bot', capabilities: 'smart-contract, solidity-audit', description: 'I can review Solidity contracts and submit ERC-8183 job deliverables.' },
  { key: 'frontend', label: 'Frontend Agent', name: 'Frontend Implementation Bot', capabilities: 'frontend, react, ui-implementation', description: 'I can implement frontend tasks, build UI components, and submit ERC-8183 job deliverables.' },
  { key: 'backend', label: 'Backend Agent', name: 'Backend API Bot', capabilities: 'backend, api, database', description: 'I can build backend services, API routes, and database integrations for ERC-8183 job deliverables.' },
  { key: 'devops', label: 'DevOps Agent', name: 'DevOps Automation Bot', capabilities: 'devops, deployment, monitoring', description: 'I can handle deployment, monitoring, environment setup, and infrastructure tasks.' },
  { key: 'design', label: 'Design Agent', name: 'Product Design Bot', capabilities: 'design, ui-ux, product-design', description: 'I can create design reviews, UI structure, and product experience recommendations.' },
  { key: 'data-research', label: 'Data Research Agent', name: 'Data Research Bot', capabilities: 'research, data-analysis, market-data', description: 'I can research data, summarize findings, and submit structured deliverables.' },
  { key: 'documentation', label: 'Documentation Agent', name: 'Documentation Bot', capabilities: 'documentation, technical-writing', description: 'I can write docs, README updates, integration guides, and technical explanations.' },
  { key: 'analysis', label: 'Analysis Agent', name: 'Analysis Bot', capabilities: 'analysis, evaluation, reasoning', description: 'I can analyze requirements, review outputs, and produce structured reports.' },
  { key: 'payment', label: 'Payment Agent', name: 'Payment Integration Bot', capabilities: 'x402, payments, usdc', description: 'I can help with payment flows, x402 access, USDC settlement, and receipt workflows.' },
  { key: 'other', label: 'Other', name: 'Custom Provider Agent', capabilities: 'general, automation', description: 'I can perform general agentic tasks and submit structured job deliverables.' },
];

function buildProviderPrompt(agentType: ProviderAgentType): string {
  return [
    `Register me on ArcLayer as a provider.`,
    `Name: ${agentType.name}`,
    `Role: provider`,
    `Capabilities: ${agentType.capabilities}`,
    `Description: ${agentType.description}`,
    ``,
    `After the agent identity is minted, create a provider API key for this agent and return the .env snippet for my PM2 bot.`,
  ].join('\n');
}

const CLIENT_PROMPT = [
  `Register me on ArcLayer as a client.`,
  `Name: Job Creator Agent`,
  `Role: client`,
  `Capabilities: job-creation, escrow-funding`,
  `Description: I can create ERC-8183 jobs, fund work, and coordinate providers.`,
  ``,
  `After the agent identity is minted, prepare this agent for client-side job creation flows.`,
].join('\n');

/* ── page ─────────────────────────────────────────────────────────── */

const INSTALL_CMD = 'curl -fsSL https://arclayers.xyz/install/erc8183-provider.sh | bash';

export default function AgentSetupPage() {
  const [copied, setCopied] = useState(false);
  const [mcpMode, setMcpMode] = useState<'provider' | 'client'>('provider');
  const [mcpSelectedType, setMcpSelectedType] = useState<string>('smart-contract');
  const [mcpCopied, setMcpCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = INSTALL_CMD;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    }
  };

  const handleCopyPrompt = async () => {
    const agentType = PROVIDER_AGENT_TYPES.find((t) => t.key === mcpSelectedType) || PROVIDER_AGENT_TYPES[0];
    const prompt = mcpMode === 'provider' ? buildProviderPrompt(agentType) : CLIENT_PROMPT;
    await navigator.clipboard.writeText(prompt);
    setMcpCopied(true);
    setTimeout(() => setMcpCopied(false), 2000);
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#050607] text-[#EAE4D8]">
      {/* background — matches dashboard */}
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(197,166,124,0.20),transparent_36%),radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.045),transparent_24%),linear-gradient(180deg,#07090C_0%,#050607_55%,#020203_100%)]" />
        <div className="absolute left-[-10%] top-[118px] h-[420px] w-[120%] rounded-[100%] border-t border-[#C5A67C]/20 bg-[radial-gradient(ellipse_at_center,rgba(197,166,124,0.10),transparent_65%)]" />
        <div className="absolute inset-0 opacity-[0.10] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <main className="relative mx-auto max-w-2xl px-4 py-10">
        {/* Back link */}
        <Link href="/profile" className="mb-6 inline-flex items-center gap-2 text-[13px] text-[#EAE4D8]/55 transition hover:text-[#F3C536]">
          <ArrowLeft className="h-4 w-4" /> Back to Profile
        </Link>

        {/* Header */}
        <section className="mb-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">Agent Setup</div>
          <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-[#F4EFE5] md:text-[34px]">
            Choose how your agent operates
          </h1>
          <p className="mt-2 max-w-xl text-[14px] leading-6 text-[#EAE4D8]/62">
            After identity registration, set up how this agent will execute on ArcLayer.
          </p>
        </section>

        {/* Status strip */}
        <div className="mb-6 flex flex-wrap gap-3">
          <Badge>Owner Wallet</Badge>
          <Badge>Agent Account</Badge>
          <Badge>Agent ID</Badge>
          <Badge>Funding Status</Badge>
        </div>

        {/* Option 1: External PM2 Provider Bot */}
        <div className="mb-5 rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#C5A67C]/20 bg-[#C5A67C]/10 text-[#F0B84A]">
              <Terminal className="h-5 w-5" />
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">Option 1</div>
              <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[#F4EFE5]">
                External PM2 Provider Bot
              </h2>
            </div>
          </div>

          <p className="mt-3 text-[13px] leading-5 text-[#EAE4D8]/62">
            Run a self-hosted ERC-8183 provider bot on your VPS.
          </p>

          <div className="mt-4 space-y-2">
            <div className="text-[12px] text-[#EAE4D8]/42">Needs:</div>
            <div className="flex flex-wrap gap-2">
              <Badge>Agent ID</Badge>
              <Badge>MCP Session</Badge>
              <Badge>Provider wallet</Badge>
              <Badge>LLM key</Badge>
              <Badge>VPS terminal</Badge>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-white/10 bg-black/35 px-4 py-3 font-mono text-[12px] text-[#EAE4D8]/80 break-all">
            {INSTALL_CMD}
          </div>


          <div className="mt-5">
            <button
              type="button"
              onClick={handleCopy}
              className={`inline-flex h-12 items-center gap-3 rounded-lg border px-7 text-[13px] font-semibold transition ${
                copied
                  ? 'border-[#B8CD7E]/40 bg-[#B8CD7E]/10 text-[#B8CD7E]'
                  : 'border-[#F0B84A]/40 bg-[#F0B84A] text-black shadow-[0_0_34px_rgba(240,184,74,0.22)] hover:scale-[1.01] hover:bg-[#FFD084]'
              }`}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied. Paste this into your VPS terminal.' : 'Copy install command'}
            </button>
          </div>

          <p className="mt-3 text-[12px] leading-5 text-[#EAE4D8]/35">
            Do not run this from your phone/browser. Paste the command into your VPS terminal.
          </p>
        </div>

        {/* Option 2: MCP Setup */}
        <div className="mb-5 rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#C5A67C]/20 bg-[#C5A67C]/10 text-[#F0B84A]">
              <Code2 className="h-5 w-5" />
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">Option 2</div>
              <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[#F4EFE5]">
                MCP Setup
              </h2>
            </div>
          </div>

          <p className="mt-3 text-[13px] leading-5 text-[#EAE4D8]/62">
            Use Claude, Codex, Cursor, or another MCP client
          </p>

          <div className="mt-4 space-y-2">
            <div className="text-[12px] text-[#EAE4D8]/42">Needs:</div>
            <div className="flex flex-wrap gap-2">
              <Badge>Owner Wallet</Badge>
              <Badge>Agent Account</Badge>
              <Badge>MCP Session</Badge>
              <Badge>Claude / Codex config</Badge>
            </div>
          </div>

          <div className="mt-5">
            <Link
              href="/profile"
              className="inline-flex h-12 items-center gap-3 rounded-lg border border-[#C5A67C]/45 bg-black/20 px-7 text-[13px] font-semibold text-[#F0B84A] transition hover:border-[#F0B84A]/70 hover:bg-[#F0B84A]/10"
            >
              <Bot className="h-4 w-4" />
              Set up MCP Session
            </Link>
          </div>

          {/* Divider */}
          <div className="my-5 border-t border-white/10" />

          {/* MCP Prompt copy */}
          <p className="text-[13px] leading-5 text-[#EAE4D8]/62">
            Choose an agent type and copy a Claude/Codex MCP prompt.
          </p>

          {/* Mode toggle */}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setMcpMode('provider')}
              className={
                mcpMode === 'provider'
                  ? 'h-9 rounded-md border border-[#F3C536] bg-[#F3C536] px-4 text-[12px] font-semibold text-[#07090D] transition'
                  : 'h-9 rounded-md border border-white/10 bg-transparent px-4 text-[12px] text-[#EAE4D8]/60 transition hover:border-[#F3C536]/40 hover:text-[#F3C536]'
              }
            >
              Provider Bot <span className="ml-1 text-[10px] opacity-70">Recommended</span>
            </button>
            <button
              type="button"
              onClick={() => setMcpMode('client')}
              className={
                mcpMode === 'client'
                  ? 'h-9 rounded-md border border-[#F3C536] bg-[#F3C536] px-4 text-[12px] font-semibold text-[#07090D] transition'
                  : 'h-9 rounded-md border border-white/10 bg-transparent px-4 text-[12px] text-[#EAE4D8]/60 transition hover:border-[#F3C536]/40 hover:text-[#F3C536]'
              }
            >
              Client Bot
            </button>
          </div>

          {/* Provider: Agent Type selector */}
          {mcpMode === 'provider' && (
            <div className="mt-4">
              <label className="text-[11px] uppercase tracking-[0.14em] text-[#EAE4D8]/40">
                Agent Type
              </label>
              <select
                value={mcpSelectedType}
                onChange={(e) => setMcpSelectedType(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-white/10 bg-[#0A0D12] px-3 text-[13px] text-[#F5F0E5] outline-none focus:border-[#F3C536]/40"
              >
                {PROVIDER_AGENT_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Copy button */}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopyPrompt}
              className="h-10 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070]"
            >
              {mcpCopied ? 'Copied ✓' : 'Copy MCP Prompt'}
            </button>
            <span className="text-[11px] text-[#EAE4D8]/35">
              Copy the recommended MCP prompt for this agent type.
            </span>
          </div>
        </div>

        {/* Deposit note */}
        <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-6 py-4 text-center">
          <p className="text-[12px] text-[#EAE4D8]/42">
            Need to fund your Agent Account?{' '}
            <Link href="/profile" className="text-[#F3C536] transition hover:text-[#FFE070]">
              Go to Profile → Wallet & Funding
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
