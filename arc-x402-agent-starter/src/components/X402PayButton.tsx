"use client";
import { useX402Pay } from "@/hooks/useX402Pay";
export function X402PayButton({ resource, label }: { resource: string; label: string }) {
  const { pay, status } = useX402Pay(resource);
  return <div className="space-y-2"><button onClick={pay}>{label}</button><p>{status}</p></div>;
}
