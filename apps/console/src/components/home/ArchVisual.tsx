'use client';

/**
 * ArchVisual — monumental ring / arch field SVG that anchors the landing's
 * right column. AUREO "orbital megastructure" feel rebuilt with ArcLayer
 * ivory/gold palette. Self-contained, no external dependencies.
 */
export default function ArchVisual() {
  return (
    <div className="relative h-full w-full max-w-[720px]">
      <svg
        viewBox="0 0 600 760"
        className="absolute inset-0 h-full w-full"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="archRim" x1="0" y1="0" x2="0" y2="760" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#EAE4D8" stopOpacity="0.78" />
            <stop offset="0.35" stopColor="#C5A67C" stopOpacity="0.9" />
            <stop offset="0.85" stopColor="#C5A67C" stopOpacity="0.22" />
            <stop offset="1" stopColor="#050505" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="archInner" x1="0" y1="0" x2="0" y2="760">
            <stop offset="0" stopColor="#C5A67C" stopOpacity="0.4" />
            <stop offset="0.6" stopColor="#C5A67C" stopOpacity="0.1" />
            <stop offset="1" stopColor="#050505" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="archVoid" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#050505" stopOpacity="0.95" />
            <stop offset="0.7" stopColor="#050505" stopOpacity="0.6" />
            <stop offset="1" stopColor="#C5A67C" stopOpacity="0" />
          </radialGradient>
          <filter id="archGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* slow rotating orbital rays */}
        <g className="anim-arch-slow" style={{ transformOrigin: '300px 290px' }}>
          {Array.from({ length: 48 }).map((_, i) => {
            const angle = (Math.PI / 48) * i;
            const x1 = 300 + Math.cos(Math.PI + angle) * 300;
            const y1 = 290 + Math.sin(Math.PI + angle) * 280;
            const x2 = 300 + Math.cos(Math.PI + angle) * 85;
            const y2 = 290 + Math.sin(Math.PI + angle) * 80;
            const major = i % 8 === 0;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={major ? 'rgba(234, 228, 216, 0.34)' : 'rgba(197, 166, 124, 0.1)'}
                strokeWidth={major ? 0.8 : 0.32}
              />
            );
          })}
        </g>

        {/* outer rim */}
        <ellipse cx="300" cy="290" rx="300" ry="280" stroke="url(#archRim)" strokeWidth="3" filter="url(#archGlow)" />
        <ellipse cx="300" cy="290" rx="294" ry="274" stroke="rgba(197, 166, 124, 0.6)" strokeWidth="1.4" />
        <ellipse cx="300" cy="290" rx="285" ry="265" stroke="rgba(197, 166, 124, 0.42)" strokeWidth="0.8" />
        <ellipse cx="300" cy="290" rx="268" ry="248" stroke="rgba(197, 166, 124, 0.28)" strokeWidth="0.6" />

        {/* concentric structural arcs */}
        {[245, 222, 200, 178, 156, 134, 112, 92].map((r, i) => (
          <ellipse
            key={r}
            cx="300"
            cy="290"
            rx={r + 20}
            ry={r}
            stroke={`rgba(197, 166, 124, ${0.38 - i * 0.035})`}
            strokeWidth="0.5"
          />
        ))}

        {/* counter-rotating mid-band */}
        <g className="anim-arch-med" style={{ transformOrigin: '300px 290px' }}>
          {Array.from({ length: 24 }).map((_, i) => {
            const angle = (Math.PI / 24) * i;
            const x1 = 300 + Math.cos(Math.PI + angle) * 225;
            const y1 = 290 + Math.sin(Math.PI + angle) * 210;
            const x2 = 300 + Math.cos(Math.PI + angle) * 175;
            const y2 = 290 + Math.sin(Math.PI + angle) * 162;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(234, 228, 216, 0.16)" strokeWidth="0.4" />;
          })}
        </g>

        {/* waypoint nodes on outer ring */}
        {Array.from({ length: 18 }).map((_, i) => {
          const angle = (Math.PI / 18) * i;
          const x = 300 + Math.cos(Math.PI + angle) * 300;
          const y = 290 + Math.sin(Math.PI + angle) * 280;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="3.2" fill="rgba(234, 228, 216, 0.9)" filter="url(#archGlow)" />
              <circle cx={x} cy={y} r="7" fill="rgba(197, 166, 124, 0.22)" />
            </g>
          );
        })}

        {/* perspective ellipses */}
        <ellipse cx="300" cy="290" rx="205" ry="44" stroke="rgba(197, 166, 124, 0.38)" strokeWidth="0.8" strokeDasharray="2 3" />
        <ellipse cx="300" cy="290" rx="160" ry="28" stroke="rgba(184, 205, 126, 0.35)" strokeWidth="0.6" />
        <ellipse cx="300" cy="290" rx="118" ry="16" stroke="rgba(234, 228, 216, 0.25)" strokeWidth="0.5" />

        {/* inner void */}
        <ellipse cx="300" cy="290" rx="76" ry="68" fill="url(#archVoid)" />
        <ellipse cx="300" cy="290" rx="76" ry="68" stroke="rgba(234, 228, 216, 0.45)" strokeWidth="0.7" />
        <ellipse cx="300" cy="290" rx="50" ry="44" fill="url(#archInner)" />
        <ellipse cx="300" cy="290" rx="28" ry="24" stroke="rgba(197, 166, 124, 0.5)" strokeWidth="0.5" />

        {/* glowing core */}
        <g filter="url(#archGlow)">
          <circle cx="300" cy="290" r="3.5" fill="#EAE4D8" className="anim-breathe" />
          <circle cx="300" cy="290" r="9" fill="rgba(234, 228, 216, 0.3)" />
          <circle cx="300" cy="290" r="16" fill="rgba(197, 166, 124, 0.14)" />
        </g>

        {/* horizon */}
        <line x1="0" y1="580" x2="600" y2="580" stroke="rgba(197, 166, 124, 0.45)" strokeWidth="0.9" />
        <line x1="0" y1="582" x2="600" y2="582" stroke="rgba(197, 166, 124, 0.18)" strokeWidth="0.4" />

        {/* city silhouette */}
        <g opacity="0.88">
          {Array.from({ length: 22 }).map((_, i) => {
            const x = 22 + i * 26;
            const h = 30 + Math.sin(i * 1.9) * 22 + (i % 4 === 0 ? 38 : 10);
            return <rect key={`far-${i}`} x={x} y={580 - h} width="3" height={h} fill="rgba(197, 166, 124, 0.1)" />;
          })}
          {Array.from({ length: 18 }).map((_, i) => {
            const x = 30 + i * 32;
            const h = 44 + Math.sin(i * 1.3) * 30 + (i % 3 === 0 ? 52 : 14);
            return <rect key={`mid-${i}`} x={x} y={580 - h} width="5" height={h} fill="rgba(197, 166, 124, 0.2)" />;
          })}
          {Array.from({ length: 30 }).map((_, i) => {
            const x = 18 + i * 20;
            const h = 26 + Math.sin(i * 0.8) * 22 + (i % 5 === 0 ? 62 : 0) + (i === 15 ? 55 : 0);
            return (
              <g key={`fg-${i}`}>
                <rect
                  x={x}
                  y={580 - h}
                  width="9"
                  height={h}
                  fill="rgba(18, 16, 12, 0.92)"
                  stroke="rgba(197, 166, 124, 0.45)"
                  strokeWidth="0.6"
                />
                {h > 55 && (
                  <>
                    <rect x={x + 2} y={580 - h + 8} width="1" height="1" fill="rgba(234, 228, 216, 0.85)" />
                    <rect x={x + 5} y={580 - h + 14} width="1" height="1" fill="rgba(197, 166, 124, 0.75)" />
                    <rect x={x + 2} y={580 - h + 22} width="1" height="1" fill="rgba(234, 228, 216, 0.65)" />
                    <rect x={x + 5} y={580 - h + 30} width="1" height="1" fill="rgba(197, 166, 124, 0.55)" />
                  </>
                )}
              </g>
            );
          })}
          {/* central spire */}
          <rect x="296" y="420" width="8" height="160" fill="rgba(30, 26, 20, 0.96)" stroke="rgba(234, 228, 216, 0.55)" strokeWidth="0.7" />
          <rect x="293" y="420" width="14" height="7" fill="rgba(197, 166, 124, 0.65)" />
          <rect x="299" y="370" width="2" height="50" fill="rgba(234, 228, 216, 0.9)" />
          <circle cx="300" cy="368" r="2.4" fill="#EAE4D8" filter="url(#archGlow)" className="anim-breathe" />
        </g>

        {/* ground fade */}
        <rect x="0" y="580" width="600" height="180" fill="url(#archInner)" opacity="0.32" />
      </svg>

      {/* Floating coordinate tags */}
      <div className="absolute left-[6%] top-[18%] aureo-glass px-3 py-2 anim-drift">
        <div className="aureo-mono-label" style={{ fontSize: '9px' }}>
          ESCROW · ACTIVE
        </div>
        <div className="mt-1 font-mono text-[11px] text-[#C5A67C]">1,250 USDC</div>
      </div>
      <div
        className="absolute right-[4%] top-[34%] aureo-glass px-3 py-2 anim-drift"
        style={{ animationDelay: '1.2s' }}
      >
        <div className="aureo-mono-label" style={{ fontSize: '9px' }}>
          PROOF · PENDING
        </div>
        <div className="mt-1 font-mono text-[11px] text-[#B8CD7E]">Milestone 03</div>
      </div>
      <div
        className="absolute left-[20%] bottom-[26%] aureo-glass px-3 py-2 anim-drift"
        style={{ animationDelay: '2.4s' }}
      >
        <div className="aureo-mono-label" style={{ fontSize: '9px' }}>
          AGENT · 0xA4
        </div>
        <div className="mt-1 font-mono text-[11px] text-[#EAE4D8]">Reputation 8.6</div>
      </div>
    </div>
  );
}
