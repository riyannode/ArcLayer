'use client';

/**
 * ClassificationLanes — 4-column layout showing ALL registered agents
 * grouped by role (Oracle → Analyzer → Evaluator → Executor).
 * Online/offline status is dynamic from presence data.
 */

import type { PredictionAgentInput } from './predictionAgentTypes';

// ─── Types ───────────────────────────────────────────────────────────────────

type LaneRole = 'oracle' | 'analyzer' | 'evaluator' | 'executor';

const LANE_ROLE_MAP: Record<string, LaneRole> = {
  oracle: 'oracle', ORACLE: 'oracle',
  analyzer: 'analyzer', ANALYZER: 'analyzer',
  analyst: 'analyzer', ANALYST: 'analyzer', analysis: 'analyzer', ANALYSIS: 'analyzer',
  evaluator: 'evaluator', EVALUATOR: 'evaluator',
  evaluation: 'evaluator', EVALUATION: 'evaluator',
  executor: 'executor', EXECUTOR: 'executor',
  execute: 'executor', EXECUTE: 'executor',
};

const LANE_ORDER: LaneRole[] = ['oracle', 'analyzer', 'evaluator', 'executor'];

const LANE_STYLE: Record<LaneRole, {
  label: string;
  color: string;
  dim: string;
  border: string;
  bg: string;
}> = {
  oracle:    { label: 'ORACLE',    color: '#22d3ee', dim: 'rgba(34,211,238,0.1)',  border: 'rgba(34,211,238,0.2)',  bg: 'rgba(34,211,238,0.04)' },
  analyzer:  { label: 'ANALYZER',  color: '#a78bfa', dim: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.2)', bg: 'rgba(167,139,250,0.04)' },
  evaluator: { label: 'EVALUATOR', color: '#fb923c', dim: 'rgba(251,146,60,0.1)',  border: 'rgba(251,146,60,0.2)',  bg: 'rgba(251,146,60,0.04)' },
  executor:  { label: 'EXECUTOR',  color: '#4ade80', dim: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.2)',  bg: 'rgba(74,222,128,0.04)' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toLaneRole(role: string): LaneRole {
  return LANE_ROLE_MAP[role] ?? 'analyzer';
}

function inferGroup(agentId: string): string {
  const id = agentId.toLowerCase();
  if (id.includes('circle') || id === 'budu-executor' || id === 'ignia-evaluator' || id === 'apollo-analyzer' || id === 'hermes-oracle') return 'Circle Commerce';
  if (id.includes('x402')) return 'x402';
  if (id.includes('pm2') || id.startsWith('24')) return 'PM2 Bridge';
  return 'External';
}

function inferProvider(agent: PredictionAgentInput): string | null {
  // Try to extract from caps or endpoint
  const caps = Array.isArray(agent.caps) ? agent.caps.join(' ').toLowerCase() : String(agent.caps || '').toLowerCase();
  const providers = ['deepseek', 'openai', 'anthropic', 'google', 'groq', 'mistral', 'together'];
  const found = providers.find((p) => caps.includes(p));
  if (found) return found;
  // Check endpoint
  const ep = String(agent.endpoint || '').toLowerCase();
  if (ep.includes('deepseek')) return 'deepseek';
  if (ep.includes('openai')) return 'openai';
  return null;
}

const PROVIDER_SHORT: Record<string, string> = {
  openai: 'gpt', anthropic: 'cld', google: 'gem', cohere: 'cmd',
  mistral: 'mis', groq: 'grq', together: 'tgt', deepseek: 'dsk',
};

function shortId(id: string): string {
  if (id.length <= 20) return id;
  return `${id.slice(0, 10)}…${id.slice(-6)}`;
}

// ─── Agent Card ──────────────────────────────────────────────────────────────

function AgentCard({ agent, style }: { agent: PredictionAgentInput; style: typeof LANE_STYLE[LaneRole] }) {
  const isOnline = agent.status === 'active';
  const provider = inferProvider(agent);
  const shortProvider = provider ? (PROVIDER_SHORT[provider] ?? provider.slice(0, 3)) : null;
  const group = inferGroup(String(agent.id || ''));
  const hasReasoning = String(agent.reasoningSummary || '') && String(agent.reasoningSummary || '') !== '—';

  return (
    <div
      className="mb-1.5 rounded-md border p-2.5 transition-[border-color] duration-200 last:mb-0 hover:border-[var(--card-border)]"
      style={{
        borderColor: style.border,
        background: style.bg,
        ['--card-border' as string]: style.color,
      }}
    >
      {/* Name row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{
              background: isOnline ? style.color : '#2a2a2a',
              boxShadow: isOnline ? `0 0 6px ${style.color}` : 'none',
            }}
          />
          <span
            className="text-[11px] font-medium"
            style={{ color: isOnline ? 'rgba(245,240,229,0.85)' : 'rgba(228,228,216,0.3)' }}
          >
            {String(agent.name || agent.id || '')}
          </span>
        </div>
        {isOnline && hasReasoning && (
          <span
            className="text-[9px] font-medium tracking-[1.2px]"
            style={{ color: style.color, opacity: 0.8, animation: 'thinkPulse 1.5s ease-in-out infinite' }}
          >
            THINKING
          </span>
        )}
      </div>

      {/* Agent ID */}
      <div className="mt-1 font-mono text-[9px] tracking-[0.3px] text-[#EAE4D8]/50">
        {shortId(String(agent.id || ''))}
      </div>

      {/* Tags */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {shortProvider && (
          <span
            className="rounded px-1.5 py-px text-[9px] tracking-[0.5px]"
            style={{ background: style.dim, color: style.color }}
          >
            {shortProvider}
            {hasReasoning && <span className="ml-0.5 opacity-60">⊙</span>}
          </span>
        )}
        <span className="text-[9px] text-[#EAE4D8]/60">{group}</span>
        {!isOnline && (
          <span className="text-[9px] text-[#EAE4D8]/40">offline</span>
        )}
      </div>
    </div>
  );
}

// ─── Lane ────────────────────────────────────────────────────────────────────

function Lane({ role, agents }: { role: LaneRole; agents: PredictionAgentInput[] }) {
  const style = LANE_STYLE[role];
  const onlineInRole = agents.filter((a) => a.status === 'active').length;

  return (
    <div
      className="flex-1 px-3.5 py-4"
      style={{ ['--lane-color' as string]: style.color }}
    >
      {/* Lane header */}
      <div
        className="flex items-center gap-2 border-b pb-3"
        style={{ borderColor: style.border }}
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{
            background: style.color,
            boxShadow: `0 0 8px ${style.color}`,
          }}
        />
        <span
          className="text-[11px] font-semibold tracking-[2.5px]"
          style={{ color: style.color }}
        >
          {style.label}
        </span>
        <span className="ml-auto font-mono text-[10px] text-[#EAE4D8]/70">
          {agents.length > 0 ? `${onlineInRole}/${agents.length}` : '—'}
        </span>
      </div>

      {/* Agent cards */}
      <div className="mt-3.5">
        {agents.length === 0 ? (
          <div className="py-2 text-center font-mono text-[10px] text-[#EAE4D8]/35">
            awaiting agents
          </div>
        ) : (
          agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} style={style} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface ClassificationLanesProps {
  agents: PredictionAgentInput[];
}

export default function ClassificationLanes({ agents }: ClassificationLanesProps) {
  // Group agents by role
  const byRole: Record<LaneRole, PredictionAgentInput[]> = {
    oracle: [], analyzer: [], evaluator: [], executor: [],
  };
  agents.forEach((a) => {
    const role = toLaneRole(String(a.role || 'analyzer'));
    byRole[role]?.push(a);
  });

  return (
    <div>
      {/* Label */}
      <div className="mb-4 font-mono text-[10px] font-medium tracking-[2px] text-[#C5A67C]/80">\n        BOT CLASSIFICATION
      </div>

      {/* Lanes */}
      <div className="flex gap-0 overflow-hidden rounded-lg border border-[#C5A67C]/08 bg-[#070707]">
        {LANE_ORDER.map((role) => (
          <Lane key={role} role={role} agents={byRole[role]} />
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-5 rounded-md bg-[#ffffff]/[0.01] px-4 py-3">
        {LANE_ORDER.map((role) => {
          const style = LANE_STYLE[role];
          const count = byRole[role].filter((a) => a.status === 'active').length;
          return (
            <div key={role} className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.5px] text-[#EAE4D8]/80">
              <span className="h-2 w-2 rounded-full" style={{ background: style.color }} />
              {style.label}
              {count > 0 && (
                <span className="ml-0.5" style={{ color: style.color }}>×{count}</span>
              )}
            </div>
          );
        })}
        <div className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-[#EAE4D8]/70">\n          <span style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.7 }}>⊙</span>
          reasoning-enabled
        </div>
      </div>
    </div>
  );
}
