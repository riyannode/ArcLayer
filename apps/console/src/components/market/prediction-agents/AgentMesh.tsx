'use client';

/**
 * AgentMesh — Canvas-based agent mesh visualization.
 * Shows ONLY online/active agents as animated nodes.
 * Particles flow between roles following the prediction pipeline.
 * Reasoning bubbles display real LLM output from live events.
 *
 * Props:
 *   agents   — PredictionAgentInput[] (ALL agents, filtered internally)
 *   reasoning — Map<agentId, reasoningText> from live event metadata
 */

import { useEffect, useRef, useCallback } from 'react';
import type { PredictionAgentInput } from './predictionAgentTypes';

// ─── Mesh role mapping ───────────────────────────────────────────────────────

type MeshRole = 'oracle' | 'analyzer' | 'evaluator' | 'executor';

const MESH_ROLE_MAP: Record<string, MeshRole> = {
  oracle: 'oracle',
  ORACLE: 'oracle',
  analyzer: 'analyzer',
  ANALYZER: 'analyzer',
  analyst: 'analyzer',
  ANALYST: 'analyzer',
  analysis: 'analyzer',
  ANALYSIS: 'analyzer',
  evaluator: 'evaluator',
  EVALUATOR: 'evaluator',
  evaluation: 'evaluator',
  EVALUATION: 'evaluator',
  executor: 'executor',
  EXECUTOR: 'executor',
  execute: 'executor',
  EXECUTE: 'executor',
};

const LANE_ORDER: MeshRole[] = ['oracle', 'analyzer', 'evaluator', 'executor'];

const ROLE_STYLE: Record<MeshRole, { color: string; label: string }> = {
  oracle:    { color: '#22d3ee', label: 'ORACLE' },
  analyzer:  { color: '#a78bfa', label: 'ANALYZER' },
  evaluator: { color: '#fb923c', label: 'EVALUATOR' },
  executor:  { color: '#4ade80', label: 'EXECUTOR' },
};

const NEXT_ROLE: Record<MeshRole, MeshRole> = {
  oracle: 'analyzer',
  analyzer: 'evaluator',
  evaluator: 'executor',
  executor: 'oracle',
};

const PROVIDER_SHORT: Record<string, string> = {
  openai: 'gpt', anthropic: 'cld', google: 'gem', cohere: 'cmd',
  mistral: 'mis', groq: 'grq', together: 'tgt', deepseek: 'dsk',
};

function toMeshRole(role: string): MeshRole {
  return MESH_ROLE_MAP[role] ?? 'analyzer';
}

// ─── Internal types ──────────────────────────────────────────────────────────

interface MeshNode {
  id: string;
  name: string;
  role: MeshRole;
  provider?: string;
  reasoningEnabled: boolean;
  // Position
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  // Animation
  pulse: number;
  enterAlpha: number;     // fade in when appearing
  isThinking: boolean;
  reasoningText?: string;
  reasoningTimer?: ReturnType<typeof setTimeout>;
  bubbleAlpha: number;    // fade in/out for reasoning bubble
}

interface MeshParticle {
  fromId: string;
  toId: string;
  progress: number;
  color: string;
  type: string;
  size: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface AgentMeshProps {
  agents: PredictionAgentInput[];
  reasoning: Map<string, string>;
}

export default function AgentMesh({ agents, reasoning }: AgentMeshProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const nodesRef = useRef<Map<string, MeshNode>>(new Map());
  const partsRef = useRef<MeshParticle[]>([]);
  const lastEventRef = useRef<number>(0);

  // Filter: only active (online) agents
  const onlineAgents = agents.filter((a) => a.status === 'active');

  // Sync nodes with current online agents
  const syncNodes = useCallback((w: number, h: number) => {
    const byRole: Record<MeshRole, PredictionAgentInput[]> = {
      oracle: [], analyzer: [], evaluator: [], executor: [],
    };
    onlineAgents.forEach((a) => {
      const role = toMeshRole(String(a.role || 'analyzer'));
      byRole[role]?.push(a);
    });

    const laneW = w / LANE_ORDER.length;

    LANE_ORDER.forEach((role, li) => {
      const laneAgents = byRole[role];
      const laneX = laneW * li + laneW / 2;
      const count = laneAgents.length;

      laneAgents.forEach((a, i) => {
        const slotH = Math.min(h / (count + 1), 130);
        const topY = (h - slotH * (count - 1)) / 2;
        const ty = count === 1 ? h / 2 : topY + i * slotH;

        const nodeId = String(a.id);
        const prev = nodesRef.current.get(nodeId);
        nodesRef.current.set(nodeId, {
          id: nodeId,
          name: String(a.name || a.id),
          role,
          provider: undefined,
          reasoningEnabled: a.reasoningSummary !== '—' && a.reasoningSummary !== '',
          x: prev?.x ?? laneX,
          y: prev?.y ?? ty,
          targetX: laneX,
          targetY: ty,
          pulse: prev?.pulse ?? Math.random() * Math.PI * 2,
          enterAlpha: prev?.enterAlpha ?? 0,
          isThinking: prev?.isThinking ?? false,
          reasoningText: prev?.reasoningText,
          reasoningTimer: prev?.reasoningTimer,
          bubbleAlpha: prev?.bubbleAlpha ?? 0,
        });
      });
    });

    // Remove nodes for agents that went offline
    const onlineIds = new Set(onlineAgents.map((a) => a.id));
    nodesRef.current.forEach((node, k) => {
      if (!onlineIds.has(k)) {
        if (node.reasoningTimer) clearTimeout(node.reasoningTimer);
        nodesRef.current.delete(k);
      }
    });
  }, [onlineAgents]);

  // Update reasoning text from real data
  useEffect(() => {
    reasoning.forEach((text, agentId) => {
      const node = nodesRef.current.get(agentId);
      if (node && !node.isThinking) {
        node.reasoningText = text;
        node.isThinking = true;
        node.bubbleAlpha = 0;
        if (node.reasoningTimer) clearTimeout(node.reasoningTimer);
        node.reasoningTimer = setTimeout(() => {
          node.isThinking = false;
          setTimeout(() => { node.reasoningText = undefined; }, 600);
        }, 5000);
      }
    });
  }, [reasoning]);

  // Spawn particle between nodes
  const spawnParticle = useCallback(() => {
    const nodeArr = [...nodesRef.current.values()];
    if (nodeArr.length < 2) return;

    const fromNode = nodeArr[Math.floor(Math.random() * nodeArr.length)];
    const preferredRole = NEXT_ROLE[fromNode.role];
    let targets = nodeArr.filter((n) => n.role === preferredRole && n.id !== fromNode.id);
    if (targets.length === 0) targets = nodeArr.filter((n) => n.id !== fromNode.id);
    if (targets.length === 0) return;
    const toNode = targets[Math.floor(Math.random() * targets.length)];

    const color = ROLE_STYLE[fromNode.role]?.color ?? '#888';
    const types = ['signal', 'reasoning', 'receipt', 'proof'];
    const type = types[Math.floor(Math.random() * types.length)];

    partsRef.current.push({
      fromId: fromNode.id,
      toId: toNode.id,
      progress: 0,
      color,
      type,
      size: type === 'receipt' ? 5 : type === 'proof' ? 4 : 3,
    });
  }, []);

  // ── Canvas draw loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let lastTs = 0;

    const draw = (ts: number) => {
      const dt = Math.min((ts - lastTs) / 1000, 0.05);
      lastTs = ts;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const tw = Math.max(1, Math.floor(rect.width * dpr));
      const th = Math.max(1, Math.floor(rect.height * dpr));

      if (canvas.width !== tw || canvas.height !== th) {
        canvas.width = tw;
        canvas.height = th;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const W = rect.width;
      const H = rect.height;

      syncNodes(W, H);
      ctx.clearRect(0, 0, W, H);

      // ── Grid ──
      ctx.strokeStyle = 'rgba(197,166,124,0.012)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < W; x += 56) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += 56) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // ── Lane dividers ──
      LANE_ORDER.forEach((_, li) => {
        if (li === 0) return;
        const x = (W / LANE_ORDER.length) * li;
        ctx.setLineDash([3, 9]);
        ctx.strokeStyle = 'rgba(197,166,124,0.03)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.setLineDash([]);
      });

      // ── Lane labels ──
      LANE_ORDER.forEach((role, li) => {
        const lx = (W / LANE_ORDER.length) * li + W / LANE_ORDER.length / 2;
        const meta = ROLE_STYLE[role];
        ctx.fillStyle = meta.color;
        ctx.globalAlpha = 0.2;
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(meta.label, lx, 20);
        ctx.globalAlpha = 1;
      });

      // ── Spawn particles periodically ──
      if (ts - lastEventRef.current > 700 + Math.random() * 1400) {
        spawnParticle();
        lastEventRef.current = ts;
      }

      // ── Node position lerp + alpha ──
      const nodeArr = [...nodesRef.current.values()];
      nodeArr.forEach((n) => {
        const lerpF = 1 - Math.pow(0.02, dt);
        n.x += (n.targetX - n.x) * lerpF;
        n.y += (n.targetY - n.y) * lerpF;
        // Enter fade
        n.enterAlpha = Math.min(1, n.enterAlpha + dt * 2);
        // Bubble alpha
        if (n.isThinking) {
          n.bubbleAlpha = Math.min(1, n.bubbleAlpha + dt * 3);
        } else {
          n.bubbleAlpha = Math.max(0, n.bubbleAlpha - dt * 2);
        }
      });

      // ── Connection lines ──
      for (let i = 0; i < nodeArr.length; i++) {
        for (let j = i + 1; j < nodeArr.length; j++) {
          const a = nodeArr[i];
          const b = nodeArr[j];
          const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
          if (d > 420) continue;
          const alpha = (0.01 + (1 - d / 420) * 0.03) * a.enterAlpha * b.enterAlpha;
          ctx.strokeStyle = `rgba(197,166,124,${alpha})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }

      // ── Particles ──
      for (let i = partsRef.current.length - 1; i >= 0; i--) {
        const p = partsRef.current[i];
        p.progress += dt * 0.55;
        if (p.progress >= 1) { partsRef.current.splice(i, 1); continue; }

        const fromN = nodesRef.current.get(p.fromId);
        const toN = nodesRef.current.get(p.toId);
        if (!fromN || !toN) continue;

        const x = fromN.x + (toN.x - fromN.x) * p.progress;
        const y = fromN.y + (toN.y - fromN.y) * p.progress;
        const env = Math.sin(p.progress * Math.PI);

        // Glow
        const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
        g.addColorStop(0, p.color + '99');
        g.addColorStop(1, p.color + '00');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();

        // Core + trail
        ctx.globalAlpha = env;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI * 2); ctx.fill();

        for (let t = 1; t <= 3; t++) {
          const tp = p.progress - t * 0.04;
          if (tp < 0) continue;
          const tx = fromN.x + (toN.x - fromN.x) * tp;
          const ty = fromN.y + (toN.y - fromN.y) * tp;
          ctx.globalAlpha = env * (1 - t * 0.3) * 0.5;
          ctx.beginPath(); ctx.arc(tx, ty, p.size * (1 - t * 0.2), 0, Math.PI * 2); ctx.fill();
        }

        // Glyph
        if (env > 0.4) {
          const glyphs: Record<string, string> = {
            signal: '≋', receipt: '◈', proof: '◆', reasoning: '⊙',
          };
          ctx.globalAlpha = env * 0.7;
          ctx.fillStyle = p.color;
          ctx.font = `${8 + p.size}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(glyphs[p.type] ?? '·', x, y - 10);
        }
        ctx.globalAlpha = 1;
      }

      // ── Nodes ──
      nodeArr.forEach((n) => {
        n.pulse += dt * (n.isThinking ? 3.5 : 1.2);
        const meta = ROLE_STYLE[n.role];
        const R = 24;
        const alpha = n.enterAlpha;

        // Thinking aura
        if (n.isThinking) {
          const p2 = (Math.sin(n.pulse * 1.8) + 1) / 2;
          const gR = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, R * 3.5);
          gR.addColorStop(0, meta.color + Math.round((30 + p2 * 40) * alpha).toString(16).padStart(2, '0'));
          gR.addColorStop(1, meta.color + '00');
          ctx.fillStyle = gR;
          ctx.beginPath(); ctx.arc(n.x, n.y, R * 3.5, 0, Math.PI * 2); ctx.fill();
        }

        // Pulse ring
        const pa = ((Math.sin(n.pulse) + 1) * 0.1 + 0.04) * alpha;
        const rr = R + 7 + Math.sin(n.pulse * 0.9) * 3;
        ctx.globalAlpha = pa;
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(n.x, n.y, rr, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;

        // Node circle with glow
        ctx.shadowColor = meta.color;
        ctx.shadowBlur = 12 * alpha;
        ctx.fillStyle = '#0a0a0a';
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 1.5 * alpha;
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(n.x, n.y, R, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;

        // Inner dot
        ctx.fillStyle = meta.color;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.isThinking ? 8 : 6, 0, Math.PI * 2); ctx.fill();

        // Reasoning spinner ring
        if (n.reasoningEnabled) {
          const spinA = (n.pulse * 0.4) % (Math.PI * 2);
          ctx.globalAlpha = 0.4 * alpha;
          ctx.strokeStyle = meta.color;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 8]);
          ctx.beginPath();
          ctx.arc(n.x, n.y, R + 14, spinA, spinA + Math.PI * 1.4);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.globalAlpha = alpha;

        // Name label
        const label = n.name.length > 16 ? n.name.slice(0, 15) + '…' : n.name;
        ctx.fillStyle = 'rgba(228,228,216,0.7)';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, n.x, n.y + R + 16);

        // ── Reasoning bubble (with fade) ──
        if (n.reasoningText && n.bubbleAlpha > 0.01) {
          const bubbleText = n.reasoningText.length > 48
            ? n.reasoningText.slice(0, 45) + '…'
            : n.reasoningText;
          const pad = 10;
          ctx.font = '9px "JetBrains Mono", monospace';
          const tw = Math.min(ctx.measureText(bubbleText).width, 200);
          const bw = tw + pad * 2;
          const bh = 26;
          const bx = n.x - bw / 2;
          const by = n.y - R - bh - 14;
          const ba = n.bubbleAlpha * alpha;

          // Bubble bg
          ctx.globalAlpha = ba * 0.95;
          ctx.fillStyle = '#0c0c0c';
          ctx.strokeStyle = meta.color + Math.round(ba * 80).toString(16).padStart(2, '0');
          ctx.lineWidth = 0.75;
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, bh, 5);
          ctx.fill(); ctx.stroke();

          // Left accent bar
          ctx.fillStyle = meta.color;
          ctx.globalAlpha = ba * 0.6;
          ctx.fillRect(bx, by + 4, 2, bh - 8);

          // Tail
          ctx.globalAlpha = ba * 0.95;
          ctx.fillStyle = '#0c0c0c';
          ctx.strokeStyle = meta.color + Math.round(ba * 80).toString(16).padStart(2, '0');
          ctx.lineWidth = 0.75;
          ctx.beginPath();
          ctx.moveTo(n.x - 5, by + bh);
          ctx.lineTo(n.x, by + bh + 8);
          ctx.lineTo(n.x + 5, by + bh);
          ctx.closePath();
          ctx.fill(); ctx.stroke();

          // Text
          ctx.fillStyle = meta.color + Math.round(ba * 200).toString(16).padStart(2, '0');
          ctx.textAlign = 'left';
          ctx.font = '9px "JetBrains Mono", monospace';
          ctx.fillText(bubbleText, bx + pad, by + bh / 2 + 3);

          // ⊙ indicator
          ctx.textAlign = 'right';
          ctx.fillStyle = meta.color + Math.round(ba * 120).toString(16).padStart(2, '0');
          ctx.font = '10px sans-serif';
          ctx.fillText('⊙', bx + bw - 6, by + bh / 2 + 4);

          ctx.textAlign = 'center';
        }

        ctx.globalAlpha = 1;
      });

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [syncNodes, spawnParticle]);

  // ── Render ──
  const onlineCount = onlineAgents.length;
  const totalCount = agents.length;
  const nodeCount = nodesRef.current.size;
  const proofCount = agents.filter((a) => a.proofActive).length;

  return (
    <div className="overflow-hidden rounded-lg border border-[#C5A67C]/12 bg-[#070707]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#C5A67C]/08 px-4 py-3">
        <span className="font-mono text-[10px] font-semibold tracking-[2.5px] text-[#C5A67C]">
          PREDICTION MARKET AGENT ACTIVITY
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] text-[#EAE4D8]/80">
          <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[#4ade80]" />
          {onlineCount}/{totalCount} live · {nodeCount} nodes · {proofCount} proof
        </span>
      </div>

      {/* Canvas */}
      <div className="relative h-[420px] w-full">
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          style={{ background: 'transparent' }}
        />
        {onlineCount === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span className="font-mono text-[11px] tracking-[1.5px] text-[#C5A67C]/60">
              NO ONLINE AGENTS
            </span>
            <a
              href="/register/external-bot?category=prediction-market-bots"
              className="font-mono text-[10px] tracking-[1.5px] text-[#C5A67C]/70 underline-offset-2 hover:underline"
            >
              Register a bot →
            </a>
          </div>
        )}
      </div>

      {/* Session bar */}
      <div className="flex items-center gap-4 border-t border-[#C5A67C]/06 px-4 py-2 font-mono text-[10px] text-[#EAE4D8]/60">
        <span>session</span>
        <span className="text-[#EAE4D8]/80">
          agents {totalCount} · online {onlineCount} · mesh {nodeCount}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[#4ade80]" />
          INDEXER · LIVE
        </span>
      </div>
    </div>
  );
}
