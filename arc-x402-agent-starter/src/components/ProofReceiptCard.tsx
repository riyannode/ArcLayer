export function ProofReceiptCard({ receipt }: { receipt: Record<string,string> }) { return <pre>{JSON.stringify(receipt, null, 2)}</pre>; }
