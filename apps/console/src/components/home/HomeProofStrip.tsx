'use client';

import { ARC_EXPLORER } from '@/lib/contracts';

/**
 * Proof strip — 4 real deployed contracts on Arc Testnet (chain 5042002)
 * with explorer links + live x402 settlement evidence row.
 * Proves the protocol is real, not marketing copy.
 */
const contracts = [
  { label: 'SETTLEMENT VAULT', addr: '0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225' },
  { label: 'AGENT IDENTITY', addr: '0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21' },
  { label: 'PROOF OF WORK', addr: '0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5' },
  { label: 'MILESTONE', addr: '0x78EA9f30744923924Fd56FcbB74D3733Ca4848f2' },
];

const ARC_NATIVE_TX = '0x52c894303c75f932e9cb892acb177cdb832c05c5f5b073d952554f085be4f264';

export default function HomeProofStrip() {
  return (
    <div
      className="mt-6 rounded-sm border border-white/10 bg-white/[0.02] p-4 section-reveal"
      style={{ animationDelay: '0.35s' }}
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className="aureo-mono-label"
          style={{ color: '#C5A67C', fontSize: '11px' }}
        >
          DEPLOYED · ARC TESTNET 5042002
        </span>
        <span
          className="aureo-mono-label"
          style={{ color: 'rgba(234, 228, 216, 0.62)', fontSize: '10px' }}
        >
          LIVE
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {contracts.map((c) => (
          <a
            key={c.label}
            href={`${ARC_EXPLORER}/address/${c.addr}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between gap-3 rounded-sm border border-white/5 bg-black/30 px-3 py-2 transition hover:border-[#C5A67C]/40 hover:bg-black/50"
          >
            <span
              className="font-mono text-[10px] uppercase tracking-[0.15em]"
              style={{ color: 'rgba(234, 228, 216, 0.68)' }}
            >
              {c.label}
            </span>
            <span className="font-mono text-[11px]" style={{ color: '#C5A67C' }}>
              {c.addr.slice(0, 6)}…{c.addr.slice(-4)}
            </span>
          </a>
        ))}
      </div>

      {/* Live x402 evidence row */}
      <div className="mt-3 flex flex-col gap-2 border-t border-white/5 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-white/40">
            x402 PAYMENT — VERIFIED ON-CHAIN
          </span>
          <span className="font-mono text-[10.5px] text-[rgba(234,228,216,0.65)]">
            Arc Native Payment settled · USDC released · proof minted
          </span>
        </div>
        <a
          href={`${ARC_EXPLORER}/tx/${ARC_NATIVE_TX}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10.5px] text-[#C5A67C] underline underline-offset-2 transition hover:text-[#EAE4D8]"
        >
          view receipt ↗
        </a>
      </div>
    </div>
  );
}
