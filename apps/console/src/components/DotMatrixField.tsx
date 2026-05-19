'use client';

import { useEffect, useRef } from 'react';

/**
 * Ambient ArcLayer background.
 * - Dot-matrix gold particles with slow orbital drift
 * - Faint radial grid pulse
 * - Pointer parallax
 * - Scanline sweep
 * - DOM fallback behind canvas
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
      baseX: number; baseY: number;
      r: number; phase: number; speed: number;
      alpha: number;
    };
    let particles: P[] = [];
    let links: Array<[number, number, number]> = []; // i, j, distSq
    let lastFrame = 0;
    let hidden = document.hidden;
    let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    const frameMs = 1000 / (isMobile ? 15 : 24);

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
      links = [];
      const spacing = isMobile ? 56 : 50;
      const cols = Math.ceil(w / spacing) + 2;
      const rows = Math.ceil(h / spacing) + 2;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const baseX = i * spacing + (j % 2 === 0 ? 0 : spacing / 2);
          const baseY = j * spacing;
          particles.push({
            baseX, baseY,
            r: Math.random() * 0.6 + 0.4,
            phase: Math.random() * Math.PI * 2,
            speed: 0.16 + Math.random() * 0.22,
            alpha: 0.1 + Math.random() * 0.3,
          });
        }
      }
      // precompute sparse neighbor link candidates (just horizontal+vertical)
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = p.baseX - q.baseX;
          const dy = p.baseY - q.baseY;
          const d2 = dx * dx + dy * dy;
          if (d2 < spacing * spacing * 1.05 && (i + j) % 3 !== 0) {
            links.push([i, j, d2]);
          }
        }
      }
    };

    const onVisibility = () => { hidden = document.hidden; };
    const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => { reducedMotion = motionMq.matches; };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current.tx = (e.clientX - rect.left - w / 2) / w;
      pointerRef.current.ty = (e.clientY - rect.top - h / 2) / h;
    };

    const start = performance.now();

    const tick = (now: number) => {
      if (hidden || reducedMotion) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (now - lastFrame < frameMs) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;
      const t = (now - start) / 1000;

      pointerRef.current.x += (pointerRef.current.tx - pointerRef.current.x) * 0.04;
      pointerRef.current.y += (pointerRef.current.ty - pointerRef.current.y) * 0.04;
      const px = pointerRef.current.x;
      const py = pointerRef.current.y;

      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.hypot(cx, cy);

      // pre-compute each particle's current position
      const posX = new Float32Array(particles.length);
      const posY = new Float32Array(particles.length);
      const parX = px * 30;
      const parY = py * 30;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const theta = t * p.speed + p.phase;
        posX[i] = p.baseX + Math.cos(theta) * 6 + parX;
        posY[i] = p.baseY + Math.sin(theta * 0.8) * 6 + parY;
      }

      // links — faint gold threads (sparse, only closest neighbors)
      ctx.lineWidth = 0.3;
      for (let k = 0; k < links.length; k++) {
        const [i, j, d2] = links[k];
        const p = particles[i];
        const q = particles[j];
        const xi = posX[i];
        const yi = posY[i];
        const xj = posX[j];
        const yj = posY[j];

        // only draw when close
        const dx = xi - xj;
        const dy = yi - yj;
        const live = dx * dx + dy * dy;
        const falloff = 1 - Math.min(1, live / (d2 * 1.6));
        if (falloff < 0.3) continue;

        const midX = (xi + xj) / 2;
        const midY = (yi + yj) / 2;
        const d = Math.hypot(midX - cx, midY - cy) / maxR;
        const depth = 1 - Math.min(1, d * 1.1);
        const a = Math.min(p.alpha, q.alpha) * 0.22 * falloff * (0.2 + depth);
        ctx.strokeStyle = `rgba(197, 166, 124, ${a})`;
        ctx.beginPath();
        ctx.moveTo(xi, yi);
        ctx.lineTo(xj, yj);
        ctx.stroke();
      }

      // dots
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const x = posX[i];
        const y = posY[i];
        const d = Math.hypot(x - cx, y - cy) / maxR;
        const depth = 1 - Math.min(1, d * 1.1);
        const a = p.alpha * (0.25 + depth * 0.9);
        ctx.beginPath();
        ctx.fillStyle = `rgba(197, 166, 124, ${a})`;
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // scanline
      const scanY = ((t * 40) % (h + 200)) - 100;
      const grad = ctx.createLinearGradient(0, scanY - 80, 0, scanY + 80);
      grad.addColorStop(0, 'rgba(197, 166, 124, 0)');
      grad.addColorStop(0.5, 'rgba(197, 166, 124, 0.055)');
      grad.addColorStop(1, 'rgba(197, 166, 124, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, scanY - 80, w, 160);

      rafRef.current = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    motionMq.addEventListener('change', onMotion);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
      motionMq.removeEventListener('change', onMotion);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        background:
          'radial-gradient(circle at 72% 18%, rgba(197, 166, 124, 0.08), transparent 42%), radial-gradient(circle at 20% 80%, rgba(184, 205, 126, 0.05), transparent 40%), linear-gradient(180deg, #050505 0%, #030303 50%, #050505 100%)',
      }}
    >
      <div className="absolute inset-0 dot-pattern opacity-30" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full opacity-75"
        style={{ mixBlendMode: 'screen' }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%)',
        }}
      />
    </div>
  );
}
