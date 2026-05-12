'use client';

type BannerTone = 'idle' | 'pending' | 'synced' | 'error';

const TONE_STYLES: Record<BannerTone, { border: string; bg: string; fg: string; accent: string }> = {
  idle: { border: 'rgba(255, 255, 255, 0.1)', bg: 'rgba(10, 10, 10, 0.6)', fg: '#9a9a9a', accent: '#7A7A7A' },
  pending: { border: 'rgba(197, 166, 124, 0.4)', bg: 'rgba(197, 166, 124, 0.06)', fg: '#EAE4D8', accent: '#C5A67C' },
  synced: { border: 'rgba(184, 205, 126, 0.4)', bg: 'rgba(184, 205, 126, 0.06)', fg: '#EAE4D8', accent: '#B8CD7E' },
  error: { border: 'rgba(230, 130, 130, 0.4)', bg: 'rgba(230, 130, 130, 0.06)', fg: '#f0c5c5', accent: '#e68282' },
};

export function StatusBanner({ tone, title, body }: { tone: BannerTone; title: string; body: string }) {
  const s = TONE_STYLES[tone];
  return (
    <div
      className="relative overflow-hidden p-4"
      style={{
        border: `1px solid ${s.border}`,
        background: s.bg,
        color: s.fg,
      }}
    >
      <span
        className="absolute left-0 top-0 h-full w-[2px]"
        style={{ background: s.accent, boxShadow: `0 0 8px ${s.accent}` }}
      />
      <div className="pl-3">
        <div className="flex items-center gap-2">
          {tone === 'pending' && <span className="pulse-dot" style={{ background: s.accent }} />}
          <p className="aureo-mono-label" style={{ color: s.accent }}>{title}</p>
        </div>
        <p className="mt-1.5 font-mono text-[11.5px] leading-5" style={{ color: s.fg }}>{body}</p>
      </div>
    </div>
  );
}
