'use client';

import { useEffect, useRef } from 'react';

/**
 * AUREO dot-matrix particle field.
 * - Canvas-backed, full-bleed.
 * - Slow orbital drift + pointer parallax.
 * - Gold particles on near-black.
 * - DOM fallback: dot-pattern CSS behind canvas.
 */
export default function DotMatrixField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    type P = {
      x: number;
      y: number;
      baseX: number;
      baseY: number;
      r: number;
      phase: number;
      speed: number;
      alpha: number;
    };
    let particles: P[] = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const seed = () => {
      particles = [];
      const spacing = 42;
      const cols = Math.ceil(w / spacing) + 2;
      const rows = Math.ceil(h / spacing) + 2;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const baseX = i * spacing + (j % 2 === 0 ? 0 : spacing / 2);
          const baseY = j * spacing;
          particles.push({
            x: baseX,
            y: baseY,
            baseX,
            baseY,
            r: Math.random() * 0.6 + 0.35,
            phase: Math.random() * Math.PI * 2,
            speed: 0.18 + Math.random() * 0.22,
            alpha: 0.12 + Math.random() * 0.28,
          });
        }
      }
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current.tx = (e.clientX - rect.left - w / 2) / w;
      pointerRef.current.ty = (e.clientY - rect.top - h / 2) / h;
    };

    const start = performance.now();

    const tick = (now: number) => {
      const t = (now - start) / 1000;

      // smooth pointer
      pointerRef.current.x += (pointerRef.current.tx - pointerRef.current.x) * 0.04;
      pointerRef.current.y += (pointerRef.current.ty - pointerRef.current.y) * 0.04;
      const px = pointerRef.current.x;
      const py = pointerRef.current.y;

      ctx.clearRect(0, 0, w, h);

      // soft depth fade (radial gradient centered, faint)
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.hypot(cx, cy);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // slow orbital drift
        const theta = t * p.speed + p.phase;
        const driftX = Math.cos(theta) * 6;
        const driftY = Math.sin(theta * 0.8) * 6;

        // pointer parallax
        const parX = px * 28;
        const parY = py * 28;

        const x = p.baseX + driftX + parX;
        const y = p.baseY + driftY + parY;

        // depth fade — particles near edges dim, center pops
        const d = Math.hypot(x - cx, y - cy) / maxR;
        const depth = 1 - Math.min(1, d * 1.1);
        const a = p.alpha * (0.25 + depth * 0.9);

        ctx.beginPath();
        ctx.fillStyle = `rgba(197, 166, 124, ${a})`;
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove, { passive: true });
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        background:
          'radial-gradient(circle at 72% 18%, rgba(197, 166, 124, 0.08), transparent 42%), linear-gradient(180deg, #050505 0%, #030303 50%, #050505 100%)',
      }}
    >
      {/* DOM fallback dot pattern — always rendered, canvas sits on top */}
      <div className="absolute inset-0 dot-pattern opacity-35" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full opacity-70"
        style={{ mixBlendMode: 'screen' }}
      />
      {/* Soft vignette for focus */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.55) 100%)',
        }}
      />
    </div>
  );
}
