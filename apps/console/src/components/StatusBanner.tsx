'use client';

type BannerTone = 'idle' | 'pending' | 'synced' | 'error';

const TONE_STYLES: Record<BannerTone, string> = {
  idle: 'border-white/10 bg-black/20 text-white/45',
  pending: 'border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-50',
  synced: 'border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-50',
  error: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
};

export function StatusBanner({
  tone,
  title,
  body,
}: {
  tone: BannerTone;
  title: string;
  body: string;
}) {
  return (
    <div className={`rounded-xl border p-4 text-sm leading-6 ${TONE_STYLES[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em]">{title}</p>
      <p className="mt-2">{body}</p>
    </div>
  );
}
