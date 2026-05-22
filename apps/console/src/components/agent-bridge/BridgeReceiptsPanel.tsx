import type { BridgeSession } from './types';
import { shortHash } from './types';

function Field({ label, value }: { label: string; value?: string | null }) {
  return <div>{label}: <span className="font-mono text-[#C5A67C]">{shortHash(value)}</span></div>;
}

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
        <div className="space-y-2">
          {receipts.map((receipt) => (
            <div key={receipt.id} className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                <span className="text-[#F5F0E5]">receipt_type: {receipt.receipt_type}</span>
                <span className="text-[#EAE4D8]/35">created_at: {new Date(receipt.created_at).toLocaleString()}</span>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-[#EAE4D8]/60 md:grid-cols-3">
                <Field label="payment_id" value={receipt.payment_id || receipt.payment_ref} />
                <Field label="transaction" value={receipt.transaction} />
                <Field label="payload_hash" value={receipt.payload_hash} />
                <Field label="session_id" value={receipt.session_id} />
                <div>created_at: <span className="font-mono text-[#C5A67C]">{new Date(receipt.created_at).toLocaleString()}</span></div>
                {receipt.transaction ? (
                  <a href={`https://testnet.arcscan.app/tx/${receipt.transaction}`} target="_blank" rel="noreferrer" className="font-mono text-[#C5A67C] underline-offset-4 hover:underline">ArcScan ↗</a>
                ) : <div>ArcScan: <span className="font-mono text-[#EAE4D8]/35">—</span></div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
