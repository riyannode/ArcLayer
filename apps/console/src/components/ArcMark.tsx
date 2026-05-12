'use client';

/**
 * ArcLayer brand mark — two curved vertical strokes forming an open arch.
 * Luminous gold/ivory glow. Matches the user-provided logo.
 */
export default function ArcMark({
  size = 48,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="ArcLayer"
    >
      <defs>
        <linearGradient id="arcLeft" x1="20" y1="8" x2="20" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#EAE4D8" />
          <stop offset="1" stopColor="#C5A67C" />
        </linearGradient>
        <linearGradient id="arcRight" x1="44" y1="8" x2="44" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#EAE4D8" />
          <stop offset="1" stopColor="#B8CD7E" />
        </linearGradient>
        <filter id="arcGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#arcGlow)" strokeLinecap="round" strokeWidth="4" fill="none">
        {/* left arch stroke */}
        <path d="M18 56 Q 18 18 30 8" stroke="url(#arcLeft)" />
        {/* right arch stroke */}
        <path d="M46 56 Q 46 18 34 8" stroke="url(#arcRight)" />
      </g>
    </svg>
  );
}
