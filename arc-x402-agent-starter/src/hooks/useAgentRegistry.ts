"use client";
import { useState } from "react";
import { useX402Pay } from "@/hooks/useX402Pay";
export function useAgentRegistry() {
  const [metadataURI, setMetadataURI] = useState("ipfs://agent");
  const [result, setResult] = useState("");
  const { pay } = useX402Pay("/api/x402/register-gate");
  async function register() { await pay(); setResult(`demo agent registered: ${metadataURI} -> #1`); }
  return { metadataURI, setMetadataURI, register, result };
}
