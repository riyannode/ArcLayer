'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * LiveLogStream — terminal-style event tail that reads real protocol data
 * from /api/indexer/overview and turns recent jobs/agents/proofs into
 * chronological log lines.
 *
 * Goal: show *real* happening, not fake ticker. We derive lines from:
 *   - summary.eventCount  → indexer.sync()
 *   - jobs[]              → escrow.fund() / job.created
 *   - agents[]            → registry.register()
 *   - proofs[]            → proof.mint()
 *
 * Lines stream top-down with staggered reveal. Oldest drop off after ~12.
 */

type LogLevel = 'info' | 'ok' | 'warn' | 'dim';
type LogLine = { id: string; ts: string; call: string; hash?: string; note?: string; level: LogLevel };

const shortHash = (h: unknown, len = 8) => {
  const s = typeof h === 'string' ? h : String(h ?? '');
  if (!s.startsWith('0x') || s.length < 10) return s.slice(0, len + 2);
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
};

const nowHHMMSS = () => {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export default function LiveLogStream() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [blockHeight, setBlockHeight] = useState<number | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    // Seed a boot sequence so the panel isn't empty on first paint.
    setLines([
      { id: 'boot-1', ts: nowHHMMSS(), call: 'arclayer.boot()',      note: 'rpc: testnet 5042002', level: 'dim' },
      { id: 'boot-2', ts: nowHHMMSS(), call: 'indexer.attach()',     note: 'source: @arclayer/indexer', level: 'dim' },
      { id: 'boot-3', ts: nowHHMMSS(), call: 'sdk.ready()',          note: 'contracts: 4 loaded', level: 'ok' },
    ]);

    const pushMany = (next: LogLine[]) => {
      if (cancelled || next.length === 0) return;
      setLines((prev) => {
        const fresh = next.filter((l) => !prev.some((p) => p.id === l.id));
        const merged = [...prev, ...fresh];
        return merged.slice(-14);
      });
    };

    const poll = async () => {
      try {
        const res = await fetch('/api/indexer/overview', { cache: 'no-store' });
        if (!res.ok) throw new Error('not ready');
        const data = await res.json();
        if (cancelled) return;
        setConnected(true);

        const s = data?.summary ?? {};
        const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
        const agents = Array.isArray(data?.agents) ? data.agents : [];
        const proofs = Array.isArray(data?.proofs) ? data.proofs : [];

        // Rough block proxy — largest createdAt, so number grows with events.
        const maxCreated = [...jobs, ...proofs]
          .map((x: { createdAt?: string | number }) => Number(x?.createdAt ?? 0))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (maxCreated.length > 0) {
          setBlockHeight(Math.max(...maxCreated) % 10_000_000);
        }

        const queued: LogLine[] = [];

        // Deduplicated job, agent, proof → log line
        jobs.forEach((j: { id?: string; client?: string; worker?: string; status?: number }) => {
          const id = `job-${j.id}`;
          if (seenRef.current.has(id)) return;
          seenRef.current.add(id);
          const statusTxt = j.status === 2 ? 'settled' : j.status === 1 ? 'funded' : 'created';
          queued.push({
            id,
            ts: nowHHMMSS(),
            call: `escrow.${statusTxt}()`,
            hash: shortHash(j.client),
            note: `job#${j.id} worker ${shortHash(j.worker)}`,
            level: j.status === 2 ? 'ok' : 'info',
          });
        });

        agents.forEach((a: { agentId?: string; controller?: string; score?: string }) => {
          const id = `agent-${a.agentId}`;
          if (seenRef.current.has(id)) return;
          seenRef.current.add(id);
          queued.push({
            id,
            ts: nowHHMMSS(),
            call: 'registry.register()',
            hash: shortHash(a.controller),
            note: `agent#${a.agentId}`,
            level: 'info',
          });
        });

        proofs.forEach((p: { tokenId?: string; jobId?: string; agentId?: string; payer?: string }) => {
          const id = `proof-${p.tokenId}`;
          if (seenRef.current.has(id)) return;
          seenRef.current.add(id);
          queued.push({
            id,
            ts: nowHHMMSS(),
            call: 'workproof.mint()',
            hash: shortHash(p.payer),
            note: `proof#${p.tokenId} · job#${p.jobId} · agent#${p.agentId}`,
            level: 'ok',
          });
        });

        // Heartbeat line every poll so you can *see* it's alive.
        queued.push({
          id: `tick-${Date.now()}`,
          ts: nowHHMMSS(),
          call: 'indexer.sync()',
          note: `events: ${s.eventCount ?? '?'}`,
          level: 'dim',
        });

        pushMany(queued);
      } catch {
        if (!cancelled) setConnected(false);
      }
    };

    poll();
    const t = setInterval(poll, 6000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="llog">
      <div className="llog-bar">
        <div className="llog-dots" aria-hidden="true">
          <span className="llog-dot r" />
          <span className="llog-dot y" />
          <span className="llog-dot g" />
        </div>
        <span className="llog-title">protocol.arclayer</span>
        <span className="llog-sep">·</span>
        <span className="llog-meta">
          block {blockHeight !== null ? blockHeight.toLocaleString() : '—'}
        </span>
        <span className="llog-grow" />
        <span className={`llog-status ${connected ? 'on' : 'off'}`}>
          <span className="llog-led" />
          {connected ? 'LIVE' : 'RECONNECT…'}
        </span>
      </div>

      <div className="llog-body" role="log" aria-live="polite">
        {lines.map((l) => (
          <div key={l.id} className={`llog-line lvl-${l.level}`}>
            <span className="llog-ts">{l.ts}</span>
            <span className="llog-chev">❯</span>
            <span className="llog-call">{l.call}</span>
            {l.hash && <span className="llog-hash">{l.hash}</span>}
            {l.note && <span className="llog-note">{l.note}</span>}
          </div>
        ))}
        <div className="llog-line cursor">
          <span className="llog-ts">{nowHHMMSS()}</span>
          <span className="llog-chev">❯</span>
          <span className="llog-caret anim-caret">▍</span>
        </div>
      </div>

      <style jsx>{`
        .llog {
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(5, 5, 5, 0.82);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          display: flex; flex-direction: column;
          box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5), 0 0 10px rgba(197,166,124,0.08);
        }
        .llog-bar {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          background: rgba(10, 10, 10, 0.95);
        }
        .llog-dots { display: inline-flex; gap: 5px; margin-right: 4px; }
        .llog-dot {
          width: 8px; height: 8px; border-radius: 9999px;
          background: rgba(255,255,255,0.15);
        }
        .llog-dot.r { background: rgba(230,130,130,0.65); }
        .llog-dot.y { background: rgba(197,166,124,0.75); }
        .llog-dot.g { background: rgba(184,205,126,0.7); }
        .llog-title {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px; letter-spacing: 0.12em;
          color: rgba(234,228,216,0.85);
        }
        .llog-sep { color: rgba(234,228,216,0.35); }
        .llog-meta {
          font-family: var(--font-mono);
          font-size: 10.5px; color: #C5A67C; letter-spacing: 0.08em;
        }
        .llog-grow { flex: 1; }
        .llog-status {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: var(--font-mono); font-size: 10px;
          letter-spacing: 0.2em; text-transform: uppercase;
        }
        .llog-status.on { color: #B8CD7E; }
        .llog-status.off { color: rgba(234,228,216,0.45); }
        .llog-led {
          width: 6px; height: 6px; border-radius: 9999px;
          background: currentColor;
          box-shadow: 0 0 6px currentColor;
          animation: llog-led-pulse 1.8s ease-in-out infinite;
        }
        @keyframes llog-led-pulse {
          0%, 100% { opacity: 0.6; } 50% { opacity: 1; }
        }
        .llog-body {
          font-family: var(--font-mono);
          font-size: 12px; line-height: 1.75;
          padding: 12px 14px;
          min-height: 240px; max-height: 280px;
          overflow: hidden;
          background: linear-gradient(180deg, rgba(5,5,5,0.6) 0%, rgba(5,5,5,0.92) 100%);
          mask-image: linear-gradient(180deg, transparent 0, black 20px, black 100%);
        }
        .llog-line {
          display: flex; gap: 10px; align-items: baseline;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          animation: llog-line-in 0.35s ease both;
        }
        @keyframes llog-line-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .llog-ts    { color: rgba(234,228,216,0.35); min-width: 64px; }
        .llog-chev  { color: #C5A67C; }
        .llog-call  { color: #EAE4D8; }
        .llog-hash  { color: #C5A67C; }
        .llog-note  { color: rgba(234,228,216,0.55); }
        .lvl-ok   .llog-call { color: #B8CD7E; }
        .lvl-warn .llog-call { color: #E6C28C; }
        .lvl-dim  .llog-call { color: rgba(234,228,216,0.65); }
        .lvl-dim  .llog-note { color: rgba(234,228,216,0.4);  }
        .llog-caret { color: #EAE4D8; }
        .cursor { opacity: 0.75; }
      `}</style>
    </div>
  );
}
