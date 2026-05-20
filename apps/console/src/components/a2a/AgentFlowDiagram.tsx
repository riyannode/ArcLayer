'use client';

/**
 * A2A Flow Diagram — visual architecture of the 3-agent autonomous network.
 *
 * Layout:
 *   [Polymarket] → [Ignia · Oracle] → [Apolo · Resolver · x402 paid]
 *                                          ↓
 *                                    [Hermes · Trader]
 *                                          ↓
 *                                    [Arc Settlement]
 *
 * This is a static SVG diagram, not interactive. Each node links to its agent
 * detail card via anchor scroll (#ignia, #apolo, #hermes).
 */

interface FlowDiagramProps {
  isLive: boolean;
  igniaActive: boolean;
  apoloActive: boolean;
  hermesActive: boolean;
}

export default function AgentFlowDiagram({ isLive, igniaActive, apoloActive, hermesActive }: FlowDiagramProps) {
  return (
    <div className="rounded border border-white/5 bg-white/[0.02] p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#777]">
          Autonomous Flow · Ignia → Apolo → Hermes
        </p>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${
          isLive ? 'border-emerald-500/30 text-emerald-300' : 'border-zinc-600/30 text-zinc-500'
        }`}>
          {isLive ? '● live' : '○ idle'}
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox="0 0 920 280"
          className="mx-auto block w-full min-w-[720px] max-w-[920px]"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="ArcLayer A2A architecture flow"
        >
          {/* Background grid */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="0.5" />
            </pattern>
            <linearGradient id="igniaGlow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.20" />
              <stop offset="100%" stopColor="#22D3EE" stopOpacity="0.04" />
            </linearGradient>
            <linearGradient id="apoloGlow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#A78BFA" stopOpacity="0.04" />
            </linearGradient>
            <linearGradient id="hermesGlow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FBBF24" stopOpacity="0.20" />
              <stop offset="100%" stopColor="#FBBF24" stopOpacity="0.04" />
            </linearGradient>
            <marker id="arrowEnd" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="#C5A67C" />
            </marker>
          </defs>

          <rect width="920" height="280" fill="url(#grid)" />

          {/* Polymarket source */}
          <g>
            <rect x="20" y="100" width="120" height="80" rx="6" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />
            <text x="80" y="130" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fill="#7A7A7A" letterSpacing="0.18em">SOURCE</text>
            <text x="80" y="150" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="14" fill="#EAE4D8">Polymarket</text>
            <text x="80" y="166" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="9" fill="#555">gamma + clob API</text>
          </g>

          {/* Ignia (Oracle) */}
          <a href="#ignia">
            <g>
              <rect x="200" y="80" width="160" height="120" rx="8" fill="url(#igniaGlow)" stroke={igniaActive ? 'rgba(34,211,238,0.6)' : 'rgba(34,211,238,0.25)'} strokeWidth="1.5" />
              <text x="280" y="105" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fill="#22D3EE" letterSpacing="0.18em">ORACLE · INTERNAL</text>
              <text x="280" y="132" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="22" fontWeight="600" fill="#EAE4D8">Ignia</text>
              <text x="280" y="156" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fill="#9CA3AF">raw signal generator</text>
              <text x="280" y="174" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="9" fill="#666">6 strategies · :4011</text>
              <circle cx="345" cy="95" r="4" fill={igniaActive ? '#22D3EE' : '#444'}>
                {igniaActive && <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />}
              </circle>
            </g>
          </a>

          {/* Apolo (Resolver / paid x402) */}
          <a href="#apolo">
            <g>
              <rect x="420" y="80" width="160" height="120" rx="8" fill="url(#apoloGlow)" stroke={apoloActive ? 'rgba(167,139,250,0.6)' : 'rgba(167,139,250,0.25)'} strokeWidth="1.5" />
              <text x="500" y="105" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fill="#A78BFA" letterSpacing="0.18em">RESOLVER · x402</text>
              <text x="500" y="132" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="22" fontWeight="600" fill="#EAE4D8">Apolo</text>
              <text x="500" y="156" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fill="#9CA3AF">paid decision engine</text>
              <text x="500" y="174" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="9" fill="#666">0.000001 USDC · :4012</text>
              <circle cx="565" cy="95" r="4" fill={apoloActive ? '#A78BFA' : '#444'}>
                {apoloActive && <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />}
              </circle>
            </g>
          </a>

          {/* Hermes (Trader) */}
          <a href="#hermes">
            <g>
              <rect x="640" y="80" width="160" height="120" rx="8" fill="url(#hermesGlow)" stroke={hermesActive ? 'rgba(251,191,36,0.6)' : 'rgba(251,191,36,0.25)'} strokeWidth="1.5" />
              <text x="720" y="105" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fill="#FBBF24" letterSpacing="0.18em">TRADER · BUYER</text>
              <text x="720" y="132" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="22" fontWeight="600" fill="#EAE4D8">Hermes</text>
              <text x="720" y="156" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fill="#9CA3AF">paper trade + PnL</text>
              <text x="720" y="174" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="9" fill="#666">autonomous loop · 24/7</text>
              <circle cx="785" cy="95" r="4" fill={hermesActive ? '#FBBF24' : '#444'}>
                {hermesActive && <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />}
              </circle>
            </g>
          </a>

          {/* Arrows: Polymarket → Ignia */}
          <line x1="140" y1="140" x2="200" y2="140" stroke="#C5A67C" strokeWidth="1.5" markerEnd="url(#arrowEnd)" opacity="0.7" />
          <text x="170" y="132" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="8" fill="#888">orderbook</text>

          {/* Ignia → Apolo */}
          <line x1="360" y1="140" x2="420" y2="140" stroke="#C5A67C" strokeWidth="1.5" markerEnd="url(#arrowEnd)" opacity="0.85" />
          <text x="390" y="132" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="8" fill="#22D3EE">raw signals</text>
          <text x="390" y="155" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="7" fill="#666">internal · POST</text>

          {/* Apolo → Hermes */}
          <line x1="580" y1="140" x2="640" y2="140" stroke="#C5A67C" strokeWidth="1.5" markerEnd="url(#arrowEnd)" opacity="0.85" />
          <text x="610" y="132" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="8" fill="#A78BFA">decision</text>
          <text x="610" y="155" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="7" fill="#666">x402 · 0.000001 USDC</text>

          {/* Hermes → Settlement */}
          <line x1="720" y1="200" x2="720" y2="240" stroke="#C5A67C" strokeWidth="1.5" markerEnd="url(#arrowEnd)" opacity="0.7" />
          <g>
            <rect x="640" y="240" width="160" height="32" rx="4" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
            <text x="720" y="261" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fill="#9CA3AF">Arc Testnet · settlement</text>
          </g>

          {/* Hermes pays Apolo (return arrow) */}
          <path d="M 640 170 Q 600 220 580 170" fill="none" stroke="rgba(245,158,11,0.45)" strokeWidth="1" strokeDasharray="4 3" markerEnd="url(#arrowEnd)" />
          <text x="610" y="220" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="7" fill="#FBBF24">USDC payment</text>
        </svg>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-cyan-500/15 bg-black/20 p-3">
          <p className="font-mono text-[9px] uppercase tracking-widest text-cyan-300/80">1 · Ignia</p>
          <p className="mt-1 font-mono text-[10.5px] leading-[1.5] text-[#9CA3AF] invisible">
            Reads Polymarket orderbook, generates raw evidence-rich signals using 6 strategy
            engines (regime, entry quality, microstructure, sniper, forecast, synthetic-arb).
            Internal-only — no payment, no execution.
          </p>
        </div>
        <div className="rounded border border-violet-500/15 bg-black/20 p-3">
          <p className="font-mono text-[9px] uppercase tracking-widest text-violet-300/80">2 · Apolo</p>
          <p className="mt-1 font-mono text-[10.5px] leading-[1.5] text-[#9CA3AF]">
            Public-paid x402 endpoint. Buyers pay 0.000001 USDC per call to fetch a final
            APPROVED/DOWNGRADED/REJECTED decision. Applies risk policy + veto filters
            on top of Ignia's raw signals.
          </p>
        </div>
        <div className="rounded border border-amber-500/15 bg-black/20 p-3">
          <p className="font-mono text-[9px] uppercase tracking-widest text-amber-300/80">3 · Hermes</p>
          <p className="mt-1 font-mono text-[10.5px] leading-[1.5] text-[#9CA3AF] invisible">
            Autonomous buyer. Pays Apolo via x402, executes paper trades, tracks PnL/winrate.
            Never holds private keys for real funds — pure paper-trading layer for the
            hackathon protocol demo.
          </p>
        </div>
      </div>
    </div>
  );
}
