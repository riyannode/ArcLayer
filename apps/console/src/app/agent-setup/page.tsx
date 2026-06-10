'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Code2, Terminal, ArrowLeft, Copy, Check } from 'lucide-react';
import { useAccount } from 'wagmi';

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md border border-[#F3C536]/20 bg-[#F3C536]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F3C536]">{children}</span>;
}

const INSTALL_CMD = 'curl -fsSL https://arclayers.xyz/install/erc8183-bot.sh | bash -s -- --role provider';
const CODEX_CMD = 'npx arclayer-codex@latest';

export default function AgentSetupPage() {
  const [copied, setCopied] = useState(false);
  const [codexCopied, setCodexCopied] = useState(false);

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

  const handleCodexCopy = async () => {
    try {
      await navigator.clipboard.writeText(CODEX_CMD);
      setCodexCopied(true);
      setTimeout(() => setCodexCopied(false), 4000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = CODEX_CMD;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCodexCopied(true);
      setTimeout(() => setCodexCopied(false), 4000);
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
          <p className="mt-3 text-[13px] leading-6 text-[#EAE4D8]/62">Start with an MCP Agent Bundle for identity, manifest, role metadata, and ArcLayer API key readiness. Manual PM2 runtime or OAuth Codex setup.</p>
        </section>
        <div className="mb-6 flex flex-wrap gap-3"><Badge>Agent ID</Badge><Badge>Manifest</Badge><Badge>Role preset</Badge><Badge>API key</Badge></div>

        <div className="mb-5 rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#C5A67C]/20 bg-[#C5A67C]/10 text-[#F0B84A]"><Terminal className="h-5 w-5" /></div><div><div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">Manual runtime option</div><h2 className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[#F4EFE5]">External PM2 Provider Bot</h2></div></div>
          <p className="mt-3 text-[13px] leading-5 text-[#EAE4D8]/62">Run a self-hosted ERC-8183 provider bot on your VPS.</p>
          <div className="mt-4 rounded-md border border-white/10 bg-black/35 px-4 py-3 font-mono text-[12px] text-[#EAE4D8]/80 break-all">{INSTALL_CMD}</div>
          <div className="mt-4"><button type="button" onClick={handleCopy} className={`inline-flex h-10 items-center gap-3 rounded-lg border px-5 text-[12px] font-semibold transition ${copied ? 'border-[#B8CD7E]/40 bg-[#B8CD7E]/10 text-[#B8CD7E]' : 'border-[#F0B84A]/40 bg-[#F0B84A] text-black shadow-[0_0_34px_rgba(240,184,74,0.22)] hover:scale-[1.01] hover:bg-[#FFD084]'}`}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy install command'}</button></div>
        </div>

        <div className="mb-5 rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#C5A67C]/20 bg-[#C5A67C]/10 text-[#F0B84A]"><Code2 className="h-5 w-5" /></div><div><div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">Recommended</div><h2 className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[#F4EFE5]">OAuth Codex Connector</h2></div></div>
          <p className="mt-3 text-[13px] leading-5 text-[#EAE4D8]/62">Run this once on the device where Codex is installed:</p>
          <div className="mt-4 rounded-md border border-white/10 bg-black/35 px-4 py-3 font-mono text-[14px] text-[#EAE4D8] break-all">{CODEX_CMD}</div>
          <div className="mt-4"><button type="button" onClick={handleCodexCopy} className={`inline-flex h-10 items-center gap-3 rounded-lg border px-5 text-[12px] font-semibold transition ${codexCopied ? 'border-[#B8CD7E]/40 bg-[#B8CD7E]/10 text-[#B8CD7E]' : 'border-[#F0B84A]/40 bg-[#F0B84A] text-black shadow-[0_0_34px_rgba(240,184,74,0.22)] hover:scale-[1.01] hover:bg-[#FFD084]'}`}>{codexCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{codexCopied ? 'Copied' : 'Copy install command'}</button></div>
          <div className="mt-6 rounded-lg border border-[#F3C536]/25 bg-[#F3C536]/[0.055] p-5 text-[13px] text-[#EAE4D8]/80">The connector uses OAuth. Codex can request wallet actions, but signing remains browser-mediated.</div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-6 py-4 text-center"><p className="text-[12px] text-[#EAE4D8]/42">Need runtime details? <Link href="/profile" className="text-[#F3C536] transition hover:text-[#FFE070]">Go to Profile</Link></p></div>
      </main>
    </div>
  );
}
