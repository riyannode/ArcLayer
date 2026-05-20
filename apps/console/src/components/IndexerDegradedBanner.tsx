type IndexerDegradedBannerProps = {
  visible?: boolean;
  className?: string;
};

export function IndexerDegradedBanner({ visible = true, className = '' }: IndexerDegradedBannerProps) {
  if (!visible) return null;

  return (
    <div
      className={`rounded-2xl border border-amber-300/35 bg-amber-400/10 px-4 py-3 text-sm text-amber-100 shadow-[0_0_30px_rgba(251,191,36,0.08)] ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="font-semibold">Indexer degraded — showing live chain data</div>
      <div className="mt-1 text-xs text-amber-100/75">
        The indexer is unavailable or stale. This view is reading directly from Arc RPC, so it may be slower and omit event-history enrichment.
      </div>
    </div>
  );
}
