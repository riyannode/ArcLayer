import type { NetworkAgent } from '@/types/agent-network';

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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
      <p className="text-[#555]">{label}</p>
      <p className="mt-0.5 truncate text-[#EAE4D8]">{value}</p>
    </div>
  );
}

export function AgentNetworkCard({ agent, selected, onSelect }: { agent: NetworkAgent; selected: boolean; onSelect: () => void }) {
  const accent = agent.name === 'Pythia' ? 'cyan' : agent.name === 'Hermes' ? 'amber' : 'zinc';
  const border = selected ? 'border-[#C5A67C]/60 bg-[#C5A67C]/[0.04]' : 'border-white/10 bg-white/[0.02]';
  const avatar = agent.name === 'Pythia' ? '◈' : agent.name === 'Hermes' ? '◆' : '◇';
  const statusColor = agent.status === 'LIVE' || agent.status === 'RUNNING' ? 'text-emerald-300 border-emerald-500/30' : 'text-zinc-500 border-zinc-600/30';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`min-w-[280px] rounded border p-4 text-left transition-colors hover:border-[#C5A67C]/40 ${border}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded border font-mono text-lg ${accent === 'cyan' ? 'border-cyan-500/25 text-cyan-300' : accent === 'amber' ? 'border-amber-500/25 text-amber-300' : 'border-zinc-500/25 text-zinc-300'}`}>
            {avatar}
          </div>
          <div>
            <p className="text-base font-semibold text-[#EAE4D8]">{agent.name}</p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#777]">{agent.role}</p>
          </div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${statusColor}`}>{agent.status}</span>
      </div>
      {agent.connectedTo && agent.connectedTo.length > 0 && (
        <p className="mt-2 inline-flex items-center gap-1 rounded border border-emerald-500/25 bg-emerald-500/[0.06] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-emerald-300/90">
          <span className="h-1 w-1 rounded-full bg-emerald-400" />
          → {agent.connectedTo.join(', ')}
        </p>
      )}
      <p className="mt-3 line-clamp-2 font-mono text-[11px] leading-5 text-[#8A8A8A]">{agent.description}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {agent.capability.slice(0, 3).map((cap) => (
          <span key={cap} className="rounded border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[9px] text-[#777]">
            {cap}
          </span>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-[10px]">
        <Stat label="Agent reputation" value={agent.reputation} />
        <Stat label="Usage" value={agent.callsServed || agent.jobsCompleted || 0} />
        <Stat label="USDC volume" value={formatUSDC(agent.revenueRaw)} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 font-mono text-[10px] text-[#555]">
        <span className="truncate">{short(agent.wallet || agent.agentId || '')}</span>
        <span className="rounded border border-[#C5A67C]/20 px-2 py-1 text-[#C5A67C]">{agent.primaryAction}</span>
      </div>
    </button>
  );
}

export function EmptyAgentState({ label }: { label: string }) {
  return (
    <div className="rounded border border-dashed border-white/10 bg-white/[0.015] p-6 text-center">
      <p className="font-mono text-xs text-[#C5A67C]">No additional autonomous agents registered yet.</p>
      <p className="mt-1 font-mono text-[11px] text-[#777]">Register an agent to make it appear in the network.</p>
      <p className="mt-2 font-mono text-[10px] text-[#555]">Current filter: {label}</p>
    </div>
  );
}
