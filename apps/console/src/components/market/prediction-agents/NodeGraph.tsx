"use client";

import { normalizeAgents, type AgentNode, type BackendAgentLike } from "./predictionAgentTypes";

interface NodeGraphProps {
  agents: BackendAgentLike[];
  activeStepIndex?: number;
}

const FLOW_ROLE_ORDER = ["ORACLE", "ANALYZER", "EVALUATOR", "MARKET-AGENT", "AGENT", "EXECUTOR"];

function flowIndex(agent: AgentNode): number {
  const directIndex = FLOW_ROLE_ORDER.indexOf(agent.role);
  if (directIndex >= 0) return directIndex;
  return FLOW_ROLE_ORDER.length;
}

function orderFlowAgents(agents: AgentNode[]): AgentNode[] {
  return [...agents].sort((a, b) => {
    const roleDelta = flowIndex(a) - flowIndex(b);
    if (roleDelta !== 0) return roleDelta;
    return a.name.localeCompare(b.name);
  });
}

export default function NodeGraph({ agents }: NodeGraphProps) {
  const normalizedAgents = orderFlowAgents(normalizeAgents(agents).filter((agent) => agent.id && agent.name));
  const liveCount = normalizedAgents.filter((agent) => agent.status === "synced" || agent.status === "active").length;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-orange-500/20 bg-[#070707] p-5 shadow-[0_0_50px_rgba(255,145,0,0.05)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,145,0,0.12),transparent_35%),radial-gradient(circle_at_80%_30%,rgba(255,255,255,0.06),transparent_28%)]" />

      <div className="relative z-10 mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-orange-400/80">
            Live Node Graph
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-100">
            Prediction Market Agent Mesh
          </h2>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          {liveCount}/{normalizedAgents.length} live nodes
        </div>
      </div>

      {normalizedAgents.length === 0 ? (
        <div className="relative z-10 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/50 p-5 text-center text-sm text-zinc-500">
          No registered prediction-market nodes found.
        </div>
      ) : (
        <div className="relative z-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {normalizedAgents.map((agent, index) => {
            const isLive = agent.status === "synced" || agent.status === "active";

            return (
              <div key={agent.id} className="relative">
                {index < normalizedAgents.length - 1 ? (
                  <div className="pointer-events-none absolute left-[calc(50%+2rem)] top-8 hidden h-px w-[calc(100%-3rem)] bg-gradient-to-r from-orange-500/50 to-transparent xl:block" />
                ) : null}

                <div
                  className={[
                    "relative min-h-[150px] rounded-xl border p-4 transition-all duration-300",
                    isLive
                      ? "border-orange-500/40 bg-orange-500/[0.08] shadow-[0_0_24px_rgba(255,145,0,0.12)]"
                      : "border-zinc-800 bg-zinc-950/60",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={[
                        "flex h-10 w-10 items-center justify-center rounded-full border font-mono text-xs font-bold",
                        isLive
                          ? "border-orange-400/50 bg-orange-400/10 text-orange-300"
                          : "border-zinc-800 bg-zinc-900 text-zinc-600",
                      ].join(" ")}
                    >
                      {index + 1}
                    </span>
                    <span
                      className={[
                        "h-2.5 w-2.5 rounded-full",
                        isLive
                          ? "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.9)]"
                          : "bg-zinc-700",
                      ].join(" ")}
                    />
                  </div>

                  <div className="mt-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-orange-300">
                      {agent.role}
                    </div>
                    <div className="mt-2 truncate text-sm font-semibold text-zinc-100">
                      {agent.name}
                    </div>
                    <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                      {agent.event}
                    </div>
                  </div>

                  <div className="mt-4 truncate font-mono text-[10px] text-zinc-600">
                    {agent.endpoint}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
