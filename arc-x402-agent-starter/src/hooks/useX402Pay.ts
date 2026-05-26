"use client";
import { useState } from "react";
export function useX402Pay(resource: string) {
  const [status, setStatus] = useState("idle");
  async function pay() {
    setStatus("requesting challenge");
    const res = await fetch(resource);
    if (res.status === 402) {
      setStatus("challenge received, retrying with demo X-PAYMENT");
      const paid = await fetch(resource, { headers: { "X-PAYMENT": "demo-payment" } });
      const json = await paid.json();
      setStatus(`unlocked: ${json.txHash ?? "demo"}`);
      return;
    }
    setStatus("unexpected response");
  }
  return { pay, status };
}
