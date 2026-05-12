'use client';

const items: [string, string][] = [
  ['NETWORK', 'Arc Testnet'],
  ['CHAIN ID', '5042002'],
  ['SETTLEMENT', 'Testnet USDC'],
  ['INDEXER', 'Live · polling'],
];

/**
 * Home footer strip — small key/value network info at bottom of landing.
 * Not the shared site Footer (that's only on non-landing pages).
 */
export default function HomeFooterStrip() {
  return (
    <div className="relative z-20 mx-auto max-w-[1600px] border-t border-white/8 px-6 py-7 md:px-12 md:pl-[80px] lg:px-24">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {items.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1.5">
            <span className="aureo-mono-label">{k}</span>
            <span className="font-mono text-[12.5px] text-[#EAE4D8]">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
