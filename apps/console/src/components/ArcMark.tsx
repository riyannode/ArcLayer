'use client';

/**
 * ArcLayer brand mark.
 *
 * Renders the canonical logo art (transparent PNG, gold/cream tones) at any
 * pixel size. Source asset lives at `/public/arclayer-logo-mark.png` and was
 * generated from the user-provided master image. For favicon/browser-tab use
 * the matching `/icon-512.png` family declared in `app/layout.tsx`.
 *
 * Notes:
 *   - PNG (not SVG) preserves the painterly glow without re-rasterizing
 *     gradients at every size.
 *   - `priority` skips lazy-load for navbar usage.
 *   - At small sizes the `glow` prop can be set to `false` so the mark stays
 *     crisp instead of bleeding into surrounding chrome.
 */
import Image from 'next/image';

export default function ArcMark({
  size = 48,
  className = '',
  glow = true,
}: {
  size?: number;
  className?: string;
  glow?: boolean;
}) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        width: size,
        height: size,
        position: 'relative',
        filter: glow && size >= 28
          ? 'drop-shadow(0 0 6px rgba(197, 166, 124, 0.35))'
          : 'none',
      }}
      aria-label="ArcLayer"
    >
      <Image
        src="/arclayer-logo-mark.png"
        alt=""
        width={size}
        height={size}
        priority
        style={{ objectFit: 'contain' }}
      />
    </span>
  );
}
