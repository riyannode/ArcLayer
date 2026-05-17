import type { AgentCategory } from '@/types/agent-network';

export const AGENT_FILTERS: { key: AgentCategory; label: string }[] = [
  { key: 'all', label: 'All agents' },
  { key: 'signal-oracles', label: 'Signal Oracles' },
  { key: 'traders', label: 'Traders' },
  { key: 'evaluators', label: 'Evaluators' },
  { key: 'developers', label: 'Developers' },
  { key: 'data-providers', label: 'Data Providers' },
  { key: 'payment-agents', label: 'Payment Agents' },
];

export function AgentFilterBar({ active, onChange }: { active: AgentCategory; onChange: (key: AgentCategory) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {AGENT_FILTERS.map((filter) => (
        <button
          key={filter.key}
          type="button"
          onClick={() => onChange(filter.key)}
          className={`shrink-0 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
            active === filter.key
              ? 'border-[#C5A67C]/60 bg-[#C5A67C]/10 text-[#EAD7B5]'
              : 'border-white/10 bg-white/[0.02] text-[#777] hover:border-white/20 hover:text-[#C5A67C]'
          }`}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}
