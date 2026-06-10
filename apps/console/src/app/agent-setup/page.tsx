'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Code2, Terminal, ArrowLeft, Copy, Check } from 'lucide-react';
import { useAccount } from 'wagmi';
import { AgentIdentityMcpSessionCard } from '@/components/agent-setup/AgentIdentityMcpSessionCard';
import { getOnboardingRolePreset, getOnboardingRolePresets } from '@/lib/agent-onboarding/role-presets';

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md border border-[#F3C536]/20 bg-[#F3C536]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F3C536]">{children}</span>;
}

type ProviderAgentType = { key: string; label: string; name: string; capabilities: string; description: string };

const PROVIDER_AGENT_TYPES: ProviderAgentType[] = getOnboardingRolePresets()
  .filter((preset) => preset.identityRole === 'provider' && !['provider'].includes(preset.id))
  .map((preset) => ({
    key: preset.id,
    label: preset.label,
    name: `${preset.title.replace(/ Agent$/, '')} Bot`,
    capabilities: preset.capabilities.join(', '),
    description: preset.description,
  }));

function buildMcpPrompt(agentType: ProviderAgentType, mode: 'provider' | 'client'): string {
  const preset = mode === 'provider'
    ? getOnboardingRolePreset(agentType.key)
    : getOnboardingRolePreset('client');
  const name = mode === 'provider' ? agentType.name : 'Job Creator Agent';
  const description = mode === 'provider'
    ? agentType.description
    : 'I can create ERC-8183 jobs, fund work, and coordinate providers.';

  return [
    'Use ArcLayer MCP Agent Bundle onboarding.',
    '',
    'Create an ArcLayer Agent Bundle with:',
    `rolePresetId: ${preset?.id || 'provider'}`,
    `name: ${name}`,
    `description: ${description}`,
    '',
    'Steps:',
    '1. Call onboarding.start_agent_bundle with the selected rolePresetId, name, and description.',
    '2. Return registrationUrl.',
    '3. Tell me to open the URL and sign/mint in ArcLayer web with the same owner wallet.',
    '4. Poll onboarding.get_agent_bundle_status until completed.',
    '5. After completed, call onboarding.create_agent_runtime_key.',
    '6. Return the final agentId, txHash, rolePresetId, role, category, capabilities, metadataURI, manifestURI, dashboardUrl, and envSnippet.',
    '7. Do not configure Runner, bot runtime, payer wallet, Circle CLI, Gateway balance, live ERC-8183 jobs, or live x402 payments yet.',
  ].join('\n');
}

const INSTALL_CMD = 'curl -fsSL https://arclayers.xyz/install/erc8183-bot.sh | bash -s -- --role provider';

export default function AgentSetupPage() {
  const { address, isConnected } = useAccount();
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
    const prompt = buildMcpPrompt(agentType, mcpMode);
    await navigator.clipboard.writeText(prompt);
    setMcpCopied(true);
    setTimeout(() => setMcpCopied(false), 2000);
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#050607] text-[#EAE4D8]">
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(197,166,124,0.20),transparent_36%),radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.045),transparent_24%),linear-gradient(180deg,#07090C_0%,#050607_55%,#020203_100%)]" />
        <div className="absolute left-[-10%] top-[118px] h-[420px] w-[120%] rounded-[100%] border-t border-[#C5A67C]/20 bg-[radial-gradient(ellipse_at_center,rgba(197,166,124,0.10),transparent_65%)]" />
        <div className="absolute inset-0 opacity-[0.10] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>
      <main className="relative mx-auto max-w-2xl px-4 py-10">
        <Link href="/profile" className="mb-6 inline-flex items-center gap-2 text-[13px] text-[#EAE4D8]/55 transition hover:text-[#F3C536]"><ArrowLeft className="h-4 w-4" /> Back to Profile</Link>
        <section className="mb-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">Agent Setup</div>
          <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-[#F4EFE5] md:text-[34px]">Choose how your agent operates</h1>
          <p className="mt-3 text-[13px] leading-6 text-[#EAE4D8]/62">Start with an MCP Agent Bundle for identity, manifest, role metadata, and ArcLayer API key readiness. Manual PM2 runtime, payer wallet, ERC-8183 execution, and x402 execution happen later.</p>
        </section>
        <div className="mb-6 flex flex-wrap gap-3"><Badge>Agent ID</Badge><Badge>Manifest</Badge><Badge>Role preset</Badge><Badge>API key</Badge></div>
        <div className="mb-5 rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#C5A67C]/20 bg-[#C5A67C]/10 text-[#F0B84A]"><Terminal className="h-5 w-5" /></div><div><div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">Manual runtime option</div><h2 className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[#F4EFE5]">External PM2 Provider Bot</h2></div></div>
          <p className="mt-3 text-[13px] leading-5 text-[#EAE4D8]/62">
            Run a self-hosted ERC-8183 provider bot on your VPS.
          </p>

          <div className="mt-4 space-y-2">
            <div className="text-[12px] text-[#EAE4D8]/42">Needs:</div>
            <div className="flex flex-wrap gap-2">
              <Badge>Agent ID</Badge>
              <Badge>Provider EOA</Badge>
              <Badge>Local private key</Badge>
              <Badge>LLM key</Badge>
              <Badge>VPS terminal</Badge>
            </div>
          </div>
          <div className="mt-4 rounded-md border border-white/10 bg-black/35 px-4 py-3 font-mono text-[12px] text-[#EAE4D8]/80 break-all">{INSTALL_CMD}</div>
          <div className="mt-5"><button type="button" onClick={handleCopy} className={`inline-flex h-12 items-center gap-3 rounded-lg border px-7 text-[13px] font-semibold transition ${copied ? 'border-[#B8CD7E]/40 bg-[#B8CD7E]/10 text-[#B8CD7E]' : 'border-[#F0B84A]/40 bg-[#F0B84A] text-black shadow-[0_0_34px_rgba(240,184,74,0.22)] hover:scale-[1.01] hover:bg-[#FFD084]'}`}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied. Paste this into your VPS terminal.' : 'Copy install command'}</button></div>
          <p className="mt-3 text-[12px] leading-5 text-[#EAE4D8]/35">Do not run this from your phone/browser. Paste the command into your VPS terminal.</p>
        </div>
        <div className="mb-5 rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#C5A67C]/20 bg-[#C5A67C]/10 text-[#F0B84A]"><Code2 className="h-5 w-5" /></div><div><div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">Recommended</div><h2 className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[#F4EFE5]">MCP Agent Bundle</h2></div></div>
          <p className="mt-3 text-[13px] leading-5 text-[#EAE4D8]/62">
            Use Claude, Codex, Cursor, or another MCP client to create identity, manifest, role/category/capabilities, and an ArcLayer API key.{' '}
            <a
              href="https://arclayers.xyz/api/mcp"
              target="_blank"
              rel="noreferrer"
              className="text-[#F3C536] underline-offset-4 hover:underline"
            >
              Live MCP
            </a>
          </p>
          <div className="mt-4 space-y-2"><div className="text-[12px] text-[#EAE4D8]/42">Needs:</div><div className="flex flex-wrap gap-2"><Badge>Owner Wallet</Badge><Badge>EOA Session</Badge><Badge>MCP Token</Badge><Badge>Claude / Codex config</Badge><Badge>API key after mint</Badge></div></div>
          <div className="mt-5">{isConnected && address ? <AgentIdentityMcpSessionCard ownerAddress={address} /> : <div className="rounded-md border border-white/10 bg-black/20 px-5 py-4 text-[13px] text-[#EAE4D8]/55">Connect your wallet to create an MCP session.</div>}</div>
          <div className="my-5 border-t border-white/10" />
          <p className="text-[13px] leading-5 text-[#EAE4D8]/62">Choose an agent type and copy a Claude/Codex Agent Bundle prompt. Bot, Runner, payer wallet, Gateway balance, live ERC-8183 execution, and x402 execution happen later.</p>
          <div className="mt-4 flex gap-2"><button type="button" onClick={() => setMcpMode('provider')} className={mcpMode === 'provider' ? 'h-9 rounded-md border border-[#F3C536] bg-[#F3C536] px-4 text-[12px] font-semibold text-[#07090D] transition' : 'h-9 rounded-md border border-white/10 bg-transparent px-4 text-[12px] text-[#EAE4D8]/60 transition hover:border-[#F3C536]/40 hover:text-[#F3C536]'}>Provider Bot <span className="ml-1 text-[10px] opacity-70">Recommended</span></button></div>
          {mcpMode === 'provider' && <div className="mt-4"><label className="text-[11px] uppercase tracking-[0.14em] text-[#EAE4D8]/75">Agent Type</label><select value={mcpSelectedType} onChange={(e) => setMcpSelectedType(e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-white/10 bg-[#0A0D12] px-3 text-[13px] text-[#F5F0E5] outline-none focus:border-[#F3C536]/40">{PROVIDER_AGENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>}
          <div className="mt-4 flex items-center gap-3"><button type="button" onClick={handleCopyPrompt} className="h-10 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070]">{mcpCopied ? 'Copied ✓' : 'Copy MCP Prompt'}</button><span className="text-[11px] text-[#EAE4D8]/35">Copy the recommended Agent Bundle prompt for this agent type.</span></div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-6 py-4 text-center"><p className="text-[12px] text-[#EAE4D8]/42">Need runtime details? <Link href="/profile" className="text-[#F3C536] transition hover:text-[#FFE070]">Go to Profile</Link></p></div>
      </main>
    </div>
  );
}
