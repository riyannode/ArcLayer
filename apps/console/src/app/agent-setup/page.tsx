'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Code2, Terminal, ArrowLeft, Copy, Check } from 'lucide-react';
import { useAccount } from 'wagmi';
import { AgentIdentityMcpSessionCard } from '@/components/agent-setup/AgentIdentityMcpSessionCard';

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md border border-[#F3C536]/20 bg-[#F3C536]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F3C536]">{children}</span>;
}

const INSTALL_CMD = 'curl -fsSL https://arclayers.xyz/install/erc8183-bot.sh | bash -s -- --role provider';

export default function AgentSetupPage() {
  const { address, isConnected } = useAccount();
  const [copied, setCopied] = useState(false);

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
          <p className="mt-3 text-[13px] leading-5 text-[#EAE4D8]/62">Use Codex or another MCP client to create agent identity, manifest, role/category/capabilities, and an ArcLayer API key. Wallet signing and ERC-8004 minting still happen in ArcLayer web.</p>
          <div className="mt-4 space-y-2"><div className="text-[12px] text-[#EAE4D8]/42">Needs:</div><div className="flex flex-wrap gap-2"><Badge>Owner Wallet</Badge><Badge>Codex Auth</Badge><Badge>Web Mint</Badge><Badge>API Key After Mint</Badge></div></div>
          <div className="mt-5 rounded-lg border border-[#F3C536]/25 bg-[#F3C536]/[0.055] p-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#F3C536]">Recommended: ArcLayer Codex Plugin</div>
            <h3 className="mt-2 text-[16px] font-semibold text-[#F4EFE5]">Install ArcLayer into Codex</h3>
            <p className="mt-2 text-[12px] leading-5 text-[#EAE4D8]/62">For local development from this repository:</p>
            <pre className="mt-3 overflow-x-auto rounded-md border border-white/10 bg-black/40 p-3 font-mono text-[12px] text-[#F4EFE5]">
git clone https://github.com/riyannode/ArcLayer
cd ArcLayer
pnpm install
pnpm --filter arclayer-mcp-connect build
node packages/mcp-connect/dist/index.js codex-plugin
            </pre>
            <p className="mt-3 text-[12px] leading-5 text-[#EAE4D8]/62">After npm publish:</p>
            <pre className="mt-1 overflow-x-auto rounded-md border border-white/10 bg-black/40 p-3 font-mono text-[12px] text-[#F4EFE5]">npx arclayer-mcp-connect@latest codex-plugin</pre>
            <ul className="mt-4 space-y-1 text-[12px] text-[#EAE4D8]/58"><li>• ArcLayer MCP server config</li><li>• ArcLayer Agent Bundle Skill</li><li>• OAuth-ready scopes</li><li>• Safe tool approval mode</li></ul>
            <p className="mt-4 text-[12px] leading-5 text-[#EAE4D8]/62">Restart Codex, then approve ArcLayer OAuth in your browser.</p>
            <p className="mt-3 rounded-md border border-emerald-400/20 bg-emerald-400/[0.05] p-3 text-[11px] leading-5 text-emerald-100/80">Codex can request ArcLayer actions, but wallet transactions still require browser approval. ArcLayer never receives your private key.</p>
          </div>
          <div className="mt-5">
            <div className="mb-3"><div className="text-[13px] font-semibold text-[#F4EFE5]">Fallback: Legacy token setup</div><p className="mt-1 text-[11px] leading-5 text-[#EAE4D8]/45">Use this only if your MCP client does not support OAuth yet. The generated command contains a one-time MCP token. Do not share it.</p></div>
            {isConnected && address ? <AgentIdentityMcpSessionCard ownerAddress={address} /> : <div className="rounded-md border border-white/10 bg-black/20 px-5 py-4 text-[13px] text-[#EAE4D8]/55">Connect your wallet to create a legacy MCP token.</div>}
          </div>
          <p className="mt-4 text-[12px] leading-5 text-[#EAE4D8]/42">After authorization, ask Codex to create an Agent Bundle. Codex returns a browser mint URL; wallet signing remains in ArcLayer web. Bot runtime, Runner, payer wallet, Gateway balance, live ERC-8183 execution, and x402 execution happen later.</p>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-6 py-4 text-center"><p className="text-[12px] text-[#EAE4D8]/42">Need runtime details? <Link href="/profile" className="text-[#F3C536] transition hover:text-[#FFE070]">Go to Profile</Link></p></div>
      </main>
    </div>
  );
}
