import type { BridgeSession } from './types';
import { shortHash } from './types';

const ARCSCAN_TX_BASE = 'https://testnet.arcscan.app/tx/';

export function BridgeReceiptsPanel({ session }: { session: BridgeSession | null }) {
  const receipts = session?.receipts ?? [];
  return (
    <div className="rounded-sm border border-white/10 bg-black/25 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Receipts / Proofs</div>
        <div className="rounded-sm border border-white/10 px-2 py-1 font-mono text-[10px] text-[#EAE4D8]/60">{receipts.length} receipts</div>
      </div>
      {receipts.length === 0 ? (
        <div className="rounded-sm border border-dashed border-white/10 p-4 text-sm text-[#EAE4D8]/55">No receipts yet.</div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {receipts.map((receipt) => (
            <div key={receipt.id} className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                <span className="text-[#F5F0E5]">{receipt.receipt_type}</span>
                <span className="text-[#EAE4D8]/35">{new Date(receipt.created_at).toLocaleString()}</span>
              </div>
              <div className="mt-2 grid gap-1.5 text-xs text-[#EAE4D8]/60">
                <div>payment_id: <span className="font-mono text-[#C5A67C]">{shortHash(receipt.payment_id || receipt.payment_ref)}</span></div>
                <div>transaction: <span className="font-mono text-[#C5A67C]">{shortHash(receipt.transaction)}</span></div>
                <div>payload_hash: <span className="font-mono text-[#C5A67C]">{shortHash(receipt.payload_hash)}</span></div>
                <div>session_id: <span className="font-mono text-[#C5A67C]">{shortHash(receipt.session_id)}</span></div>
              </div>
              {receipt.transaction ? (
                <a href={`${ARCSCAN_TX_BASE}${receipt.transaction}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex font-mono text-[10px] uppercase tracking-[0.16em] text-[#C5A67C] hover:text-[#F5F0E5]">ArcScan tx →</a>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
