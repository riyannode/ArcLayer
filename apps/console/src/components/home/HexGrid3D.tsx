'use client';

import { useEffect, useRef, useState } from 'react';
import ArcMark from '@/components/ArcMark';

/**
 * HexGrid3D — 3D rotating honeycomb with the ArcMark logo core.
 *
 * Three counter-rotating layers give mechanical-watch depth:
 *   1. Outer orbital rings (rotate Z clockwise, 48s)
 *   2. Hex cells grid      (rotate Y anti-clockwise, 28s) — the main stage
 *   3. Core frame + logo   (rotate Y clockwise, 14s counter)
 *
 * Mouse parallax tilts the whole composition ±10° on X/Y as the cursor moves,
 * smoothed with a lerp factor. Respects prefers-reduced-motion.
 *
 * Particle trails (gold dots) spawn from the core every ~0.9s and fly toward
 * a random active hex cell — communicating "the logo broadcasts signals to
 * contracts". Pool-based, zero runtime alloc spam.
 */

type HexCell = {
  q: number;
  r: number;
  depth: number;
  active: boolean;
  delay: number;
  x: number;
  y: number;
};

const HEX_SIZE = 28;
const SQRT3 = Math.sqrt(3);

function axialToXY(q: number, r: number) {
  const x = HEX_SIZE * SQRT3 * (q + r / 2);
  const y = HEX_SIZE * 1.5 * r;
  return { x, y };
}

function buildRings(radius: number): HexCell[] {
  const cells: HexCell[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const s = -q - r;
      if (Math.abs(s) > radius) continue;
      if (q === 0 && r === 0) continue;
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
      const { x, y } = axialToXY(q, r);
      cells.push({
        q,
        r,
        x,
        y,
        depth: (ring - 2) * 20 + Math.sin(q * 2.3 + r * 1.7) * 14,
        active: ring === 2 ? (q + r) % 2 === 0 : Math.abs(q * r) === 2,
        delay: (Math.abs(q) + Math.abs(r)) * 0.15 + (q + r) * 0.05,
      });
    }
  }
  return cells;
}

function hexPath(s: number) {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(`${(s * Math.cos(a)).toFixed(2)},${(s * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

const cells = buildRings(3);
const activeCells = cells.filter((c) => c.active);
const HEX_D = hexPath(HEX_SIZE * 0.92);

// ---------- Particle pool ----------
const PARTICLE_POOL = 10;
type Particle = {
  id: number;
  x: number; // current SVG x
  y: number; // current SVG y
  tx: number; // target x
  ty: number; // target y
  life: number; // 0..1 progression
  speed: number;
  alive: boolean;
};

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_POOL }, (_, i) => ({
    id: i,
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    life: 1,
    speed: 0,
    alive: false,
  }));
}

export default function HexGrid3D() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const mouseRef = useRef({ tx: 0, ty: 0, x: 0, y: 0 }); // target + current (lerped)
  const particlesRef = useRef<Particle[]>(makeParticles());
  const spawnAccumRef = useRef(0);
  const prevTimeRef = useRef<number | null>(null);
  const [, forceRender] = useState(0);
  const reducedMotionRef = useRef(false);

  // Detect reduced motion (no parallax, no particles)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const on = () => {
      reducedMotionRef.current = mq.matches;
    };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Track cursor relative to stage center (-1..1 per axis)
  useEffect(() => {
    if (reducedMotionRef.current) return;
    const onMove = (e: MouseEvent) => {
      const el = stageRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / (rect.width / 2);
      const dy = (e.clientY - cy) / (rect.height / 2);
      mouseRef.current.tx = Math.max(-1.2, Math.min(1.2, dx));
      mouseRef.current.ty = Math.max(-1.2, Math.min(1.2, dy));
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // RAF: smooth parallax + particle sim
  useEffect(() => {
    if (reducedMotionRef.current) return;

    const tick = (t: number) => {
      const dt = prevTimeRef.current == null ? 16 : Math.min(48, t - prevTimeRef.current);
      prevTimeRef.current = t;

      // Lerp mouse toward target
      const m = mouseRef.current;
      m.x += (m.tx - m.x) * 0.08;
      m.y += (m.ty - m.y) * 0.08;

      // Apply parallax transform to outer wrapper (via CSS vars)
      const el = stageRef.current;
      if (el) {
        const tiltX = -m.y * 10; // mouse up → tilt forward
        const tiltY = m.x * 14;
        el.style.setProperty('--tilt-x', `${tiltX.toFixed(2)}deg`);
        el.style.setProperty('--tilt-y', `${tiltY.toFixed(2)}deg`);
      }

      // Particle spawner
      spawnAccumRef.current += dt;
      if (spawnAccumRef.current > 550 && activeCells.length > 0) {
        spawnAccumRef.current = 0;
        const free = particlesRef.current.find((p) => !p.alive);
        if (free) {
          const target = activeCells[Math.floor(Math.random() * activeCells.length)];
          free.x = 0;
          free.y = 0;
          free.tx = target.x;
          free.ty = target.y;
          free.life = 0;
          free.speed = 0.0012 + Math.random() * 0.0008; // progress/ms
          free.alive = true;
        }
      }

      // Particle advance
      for (const p of particlesRef.current) {
        if (!p.alive) continue;
        p.life += p.speed * dt;
        if (p.life >= 1) {
          p.alive = false;
        }
      }

      forceRender((n) => (n + 1) % 1e9);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={stageRef}
      className="hex-wrap relative h-full w-full flex items-center justify-center select-none"
      style={{
        perspective: '1400px',
        // parallax tilt applied via CSS vars
        ['--tilt-x' as string]: '0deg',
        ['--tilt-y' as string]: '0deg',
      }}
      aria-hidden="true"
    >
      {/* Layer 1 — outer dashed orbital rings (rotate Z, slow CW) */}
      <div className="hex-layer-outer absolute" style={{ width: 560, height: 560 }}>
        <svg viewBox="-320 -320 640 640" className="h-full w-full">
          <circle
            cx="0"
            cy="0"
            r="290"
            fill="none"
            stroke="rgba(197, 166, 124, 0.18)"
            strokeWidth="0.6"
            strokeDasharray="1 6"
          />
          <circle
            cx="0"
            cy="0"
            r="260"
            fill="none"
            stroke="rgba(234, 228, 216, 0.08)"
            strokeWidth="0.4"
            strokeDasharray="2 10"
          />
          <circle
            cx="0"
            cy="0"
            r="230"
            fill="none"
            stroke="rgba(197, 166, 124, 0.1)"
            strokeWidth="0.4"
          />
        </svg>
      </div>

      {/* Layer 2 — hex cells stage (Y-axis, main honeycomb) */}
      <div className="hex-stage relative" style={{ width: 560, height: 560 }}>
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(closest-side, rgba(197,166,124,0.08) 0%, rgba(5,5,5,0) 72%)',
            transform: 'translateZ(-120px)',
          }}
        />

        <svg
          viewBox="-300 -300 600 600"
          className="absolute inset-0 h-full w-full"
          style={{ transformStyle: 'preserve-3d' }}
        >
          <defs>
            <linearGradient id="hexStroke" x1="0" y1="-30" x2="0" y2="30" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#EAE4D8" stopOpacity="0.45" />
              <stop offset="1" stopColor="#C5A67C" stopOpacity="0.18" />
            </linearGradient>
            <linearGradient id="hexActive" x1="0" y1="-30" x2="0" y2="30" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#EAE4D8" stopOpacity="0.9" />
              <stop offset="1" stopColor="#C5A67C" stopOpacity="0.7" />
            </linearGradient>
            <filter id="hexGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="particleGlow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="1.6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {cells.map((c) => (
            <g
              key={`${c.q}-${c.r}`}
              transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})`}
              className={c.active ? 'hex-active' : 'hex-idle'}
              style={{ animationDelay: `${c.delay}s` }}
            >
              <path
                d={HEX_D}
                fill={c.active ? 'rgba(197, 166, 124, 0.1)' : 'rgba(10, 10, 10, 0.6)'}
                stroke={c.active ? 'url(#hexActive)' : 'url(#hexStroke)'}
                strokeWidth={c.active ? 1.1 : 0.55}
                filter={c.active ? 'url(#hexGlow)' : undefined}
              />
              {c.active && (
                <circle
                  cx="0"
                  cy="0"
                  r="2"
                  fill="#EAE4D8"
                  filter="url(#hexGlow)"
                  className="hex-core-dot"
                />
              )}
            </g>
          ))}

          {/* Particle trails — ivory head + gold glow halo + trail */}
          {particlesRef.current.map((p) => {
            if (!p.alive) return null;
            const eased = 1 - Math.pow(1 - p.life, 2.2);
            const x = p.tx * eased;
            const y = p.ty * eased;
            const opacity = p.life < 0.12
              ? p.life / 0.12
              : p.life > 0.82
                ? (1 - p.life) / 0.18
                : 1;
            const trailEased = 1 - Math.pow(1 - Math.max(0, p.life - 0.2), 2.2);
            const tx = p.tx * trailEased;
            const ty = p.ty * trailEased;
            return (
              <g key={p.id} className="hex-particle">
                {/* Trail line */}
                <line
                  x1={tx}
                  y1={ty}
                  x2={x}
                  y2={y}
                  stroke="rgba(234, 228, 216, 0.85)"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  opacity={opacity * 0.9}
                />
                {/* Outer gold halo */}
                <circle
                  cx={x}
                  cy={y}
                  r={6}
                  fill="rgba(197, 166, 124, 0.45)"
                  opacity={opacity * 0.9}
                  filter="url(#particleGlow)"
                />
                {/* Leading bright head */}
                <circle
                  cx={x}
                  cy={y}
                  r={3.2}
                  fill="#FFF7E6"
                  opacity={opacity}
                  filter="url(#particleGlow)"
                />
                {/* Inner hot core */}
                <circle
                  cx={x}
                  cy={y}
                  r={1.4}
                  fill="#FFFFFF"
                  opacity={opacity}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Layer 3 — central core: ArcMark logo (no shield), counter-rotating on Y */}
      <div
        className="hex-core absolute flex items-center justify-center"
        style={{
          width: 220,
          height: 220,
          transform: 'translateZ(140px)',
        }}
      >
        <div className="relative z-10 hex-core-logo">
          <ArcMark size={140} />
        </div>
      </div>

      {/* Scan ring — soft animated equator */}
      <div className="hex-scan absolute" style={{ width: 540, height: 540 }}>
        <svg width="540" height="540" viewBox="-270 -270 540 540">
          <ellipse
            cx="0"
            cy="0"
            rx="240"
            ry="46"
            fill="none"
            stroke="rgba(184, 205, 126, 0.35)"
            strokeWidth="0.8"
            strokeDasharray="3 5"
          />
        </svg>
      </div>

      <style jsx>{`
        /* Parallax wrapper — tilts EVERYTHING inside based on mouse */
        .hex-wrap {
          transform: rotateX(var(--tilt-x)) rotateY(var(--tilt-y));
          transform-style: preserve-3d;
          transition: transform 120ms linear;
        }

        /* Layer 1: outer ring, Z-axis CW slow */
        .hex-layer-outer {
          transform-style: preserve-3d;
          animation: hex-outer-orbit 48s linear infinite;
          will-change: transform;
        }
        @keyframes hex-outer-orbit {
          0%   { transform: rotateX(-28deg) rotateZ(0deg); }
          100% { transform: rotateX(-28deg) rotateZ(360deg); }
        }

        /* Layer 2: main hex stage, Y-axis anti-CW */
        .hex-stage {
          transform-style: preserve-3d;
          animation: hex-stage-orbit 28s linear infinite;
          will-change: transform;
        }
        @keyframes hex-stage-orbit {
          0%   { transform: rotateX(-28deg) rotateY(0deg); }
          100% { transform: rotateX(-28deg) rotateY(-360deg); }
        }

        /* Layer 3: core logo, Y-axis rotation (no shield frame, logo itself rotates) */
        .hex-core {
          transform-style: preserve-3d;
          animation: hex-core-spin 12s linear infinite;
        }
        @keyframes hex-core-spin {
          0%   { transform: translateZ(140px) translateY(0px) rotateY(0deg); }
          50%  { transform: translateZ(140px) translateY(-8px) rotateY(180deg); }
          100% { transform: translateZ(140px) translateY(0px) rotateY(360deg); }
        }

        /* Logo breathing — scale + glow, stacks on top of core rotation */
        .hex-core-logo {
          animation: hex-core-breathe 3.6s ease-in-out infinite;
          transform-style: preserve-3d;
        }
        @keyframes hex-core-breathe {
          0%, 100% {
            transform: scale(1);
            filter:
              drop-shadow(0 0 18px rgba(197, 166, 124, 0.85))
              drop-shadow(0 0 38px rgba(234, 228, 216, 0.35));
          }
          50% {
            transform: scale(1.1);
            filter:
              drop-shadow(0 0 36px rgba(197, 166, 124, 1))
              drop-shadow(0 0 62px rgba(234, 228, 216, 0.55));
          }
        }

        .hex-active {
          animation: hex-pulse 3.6s ease-in-out infinite;
        }
        @keyframes hex-pulse {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1;    }
        }

        .hex-core-dot {
          animation: hex-dot-pulse 2.2s ease-in-out infinite;
        }
        @keyframes hex-dot-pulse {
          0%, 100% { opacity: 0.5; }
          50%      { opacity: 1;   }
        }

        .hex-scan {
          animation: hex-scan-rotate 24s linear infinite;
        }
        @keyframes hex-scan-rotate {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .hex-idle { opacity: 0.38; }

        @media (prefers-reduced-motion: reduce) {
          .hex-wrap,
          .hex-layer-outer,
          .hex-stage,
          .hex-core,
          .hex-core-logo,
          .hex-active,
          .hex-core-dot,
          .hex-scan {
            animation: none;
            transform: none;
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
