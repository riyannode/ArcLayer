'use client';

const items: [string, string][] = [
  ['NETWORK', 'Arc Testnet'],
  ['CHAIN ID', '5042002'],
  ['SETTLEMENT', 'Testnet USDC'],
  ['INDEXER', 'Live · polling'],
];

/**
 * Home footer strip — compact horizontal network info bar. Single row,
 * tight divider-separated items. Not the shared site Footer.
 */
export default function HomeFooterStrip() {
  return (
    <div className="relative z-20 w-full pb-4 mt-auto">
      <div className="flex flex-wrap items-stretch divide-x divide-white/[0.08] px-6 md:px-12 md:pl-[80px] lg:px-24">
        {items.map(([k, v], i) => (
          <div
            key={k}
            className="flex min-w-[140px] flex-1 items-center gap-3 py-4"
            style={{ paddingLeft: i === 0 ? 0 : '20px', paddingRight: '20px' }}
          >
            <span className="aureo-mono-label whitespace-nowrap" style={{ fontSize: '10.5px' }}>
              {k}
            </span>
            <span className="font-mono text-[12.5px] text-[#EAE4D8] whitespace-nowrap">
              {v}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
