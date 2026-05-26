import { LiveFlowTimeline } from "@/components/LiveFlowTimeline";
import { ProofReceiptCard } from "@/components/ProofReceiptCard";
import { buildDemoReceipt } from "@/lib/receipt";
export default function ProofPage(){const receipt=buildDemoReceipt(); return <main className="p-8"><h1>Proof</h1><LiveFlowTimeline/><ProofReceiptCard receipt={receipt}/></main>;}
