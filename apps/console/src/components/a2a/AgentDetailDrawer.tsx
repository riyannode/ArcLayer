import { useState } from 'react';
import Link from 'next/link';
import type { NetworkAgent, FeedItem } from '@/types/agent-network';

const TYPE_COLORS: Record<FeedItem['type'], string> = {
  signal: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  payment: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  decision: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  trade: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  balance: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
};

const AGENT_COLORS: Record<'Ignia' | 'Apolo' | 'Hermes', string> = {
  Ignia: 'text-cyan-300',
  Apolo: 'text-violet-300',
  Hermes: 'text-amber-300',
};

function short(addr: string) {
  if (!addr || addr.length < 12) return addr || '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatUSDC(raw: string) {
  const n = Number(raw) / 1e6;
  if (n > 0 && n < 0.01) return n.toFixed(3);
  if (n < 1) return n.toFixed(3);
  return n.toFixed(2);
}

function timeAgoIso(iso: string) {
  const diff = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (diff < 0) return 'now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
      <p className="text-[#555]">{label}</p>
      <p className="mt-0.5 truncate text-[#EAE4D8]">{value}</p>
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  return (
    <div className="flex items-start gap-3 border-b border-white/5 px-1 py-2.5">
      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${TYPE_COLORS[item.type]}`}>
        {item.type}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-[#EAE4D8]">
          <span className={`font-semibold ${AGENT_COLORS[item.agent]}`}>{item.agent}</span>{' '}
          <span className="text-[#b5b5b5]">{item.label}</span>
        </p>
        <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-[#555]">
          <span>{timeAgoIso(item.ts)}</span>
          {item.tx && (
            <a href={`https://testnet.arcscan.app/tx/${item.tx}`} target="_blank" rel="noopener noreferrer" className="truncate text-[#a0a0a0] hover:text-[#C5A67C]">
              {item.tx.slice(0, 10)}…
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function AgentDetailDrawer({
  agent,
  onClose,
  onHide,
  onDeactivate,
  isDeactivating = false,
}: {
  agent: NetworkAgent | null;
  onClose: () => void;
  onHide?: (agentId: string) => void;
  onDeactivate?: (agent: NetworkAgent) => Promise<void>;
  isDeactivating?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (!agent) return null;

  const copyWallet = async () => {
    const value = agent.wallet || agent.agentId;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <aside className="ml-auto h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#0A0A0A] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#C5A67C]">Agent profile</p>
            <h3 className="mt-1 text-2xl font-semibold text-[#EAE4D8]">{agent.name}</h3>
            <p className="font-mono text-xs text-[#777]">{agent.role}</p>
            {agent.connectedTo && agent.connectedTo.length > 0 && (
              <p className="mt-1 inline-flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Connected → {agent.connectedTo.join(', ')}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded border border-white/10 px-2 py-1 font-mono text-xs text-[#777] hover:text-[#EAE4D8]">
            close
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href={`/a2a/agents/${agent.id}`}
            className="rounded border border-[#C5A67C]/30 bg-[#C5A67C]/[0.06] px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-[#C5A67C] hover:bg-[#C5A67C]/15"
          >
            View full profile →
          </Link>
          <Link
            href={`/jobs?agent=${agent.id}`}
            className="rounded border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/15"
          >
            Hire this agent
          </Link>
        </div>

        <p className="mt-4 font-mono text-[12px] leading-6 text-[#b5b5b5]">{agent.description}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {agent.capability.map((cap) => (
            <span key={cap} className="rounded border border-[#C5A67C]/20 bg-[#C5A67C]/5 px-2 py-1 font-mono text-[10px] text-[#EAD7B5]">
              {cap}
            </span>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 font-mono text-xs">
          <Stat label="Agent reputation" value={agent.reputation} />
          <Stat label="Jobs completed" value={agent.jobsCompleted} />
          <Stat label="Signals served" value={agent.callsServed} />
          <Stat label="USDC volume" value={`${formatUSDC(agent.revenueRaw)} USDC`} />
          <Stat label="Wallet balance" value={agent.balanceRaw ? `${formatUSDC(agent.balanceRaw)} USDC` : '—'} />
          <Stat label="Status" value={agent.status} />
        </div>

        <div className="mt-5 space-y-2 rounded border border-white/10 bg-white/[0.02] p-3 font-mono text-[11px]">
          <div>
            <p className="text-[#555]">Wallet / controller</p>
            <p className="break-all text-[#EAE4D8]">{agent.wallet || '—'}</p>
          </div>
          <div>
            <p className="text-[#555]">Agent ID</p>
            <p className="break-all text-[#EAE4D8]">{agent.agentId || agent.id}</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {['Create Job', 'Request Signal', 'x402 Pay', copied ? '✓ Copied' : 'Copy Wallet'].map((action) => (
            <button
              key={action}
              type="button"
              onClick={action.includes('Copy') || action.includes('Copied') ? copyWallet : undefined}
              className="rounded border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[#C5A67C] hover:border-[#C5A67C]/40"
            >
              {action}
            </button>
          ))}
        </div>

        {agent.canHide && onHide && (
          <div className="mt-4 rounded border border-red-500/15 bg-red-950/[0.05] p-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-red-300/80">Dashboard control</p>
            <p className="mt-1 font-mono text-[11px] text-[#c0aaaa]">
              Hides this agent from your dashboard view. The agent stays registered on-chain — only your local list is filtered.
            </p>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Hide ${agent.name} from your dashboard?\n\nThis only affects what you see locally. The agent remains registered on-chain.`)) {
                  onHide(agent.id);
                  onClose();
                }
              }}
              className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-red-300 hover:bg-red-500/20"
            >
              Hide from dashboard
            </button>
          </div>
        )}

        {agent.canHide && onDeactivate && (
          <div className="mt-3 rounded border border-red-500/20 bg-red-950/[0.08] p-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-red-400/90">On-chain deactivation</p>
            <p className="mt-1 font-mono text-[11px] text-[#c0aaaa]">
              Permanently deactivates this agent on-chain. Requires wallet signature from the agent controller.
            </p>
            <button
              type="button"
              disabled={isDeactivating}
              onClick={async () => {
                if (confirm(`Deactivate ${agent.name} on-chain?\n\nThis calls deactivateAgent() on the AgentRegistry contract. The agent will be marked inactive permanently.`)) {
                  await onDeactivate(agent);
                }
              }}
              className="mt-2 rounded border border-red-500/40 bg-red-500/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-red-200 hover:bg-red-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDeactivating ? 'Deactivating…' : 'Deactivate on-chain'}
            </button>
          </div>
        )}

        <div className="mt-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#C5A67C]">Recent x402/payment receipts</p>
          <div className="mt-2 space-y-2">
            {agent.activity.filter((item) => item.tx).slice(0, 4).map((item) => (
              <a key={item.id} href={`https://testnet.arcscan.app/tx/${item.tx}`} target="_blank" rel="noopener noreferrer" className="block rounded border border-white/10 bg-white/[0.02] p-2 font-mono text-[11px] text-[#b5b5b5] hover:border-[#C5A67C]/30">
                Payment receipt · {short(item.tx || '')} ↗
              </a>
            ))}
            {agent.activity.filter((item) => item.tx).length === 0 && (
              <p className="rounded border border-white/10 bg-white/[0.02] p-2 font-mono text-[11px] text-[#555]">No recent payment receipts for this agent.</p>
            )}
          </div>
        </div>

        <div className="mt-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#C5A67C]">Agent history</p>
          <div className="mt-2 max-h-80 overflow-y-auto rounded border border-white/10 bg-black/20 p-2">
            {agent.activity.length > 0 ? agent.activity.map((item) => <FeedRow key={item.id} item={item} />) : (
              <p className="p-3 font-mono text-[11px] text-[#555]">No recent autonomous activity for this agent.</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
