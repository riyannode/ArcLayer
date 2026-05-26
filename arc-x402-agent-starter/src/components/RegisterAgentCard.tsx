"use client";
import { useAgentRegistry } from "@/hooks/useAgentRegistry";
export function RegisterAgentCard() {
  const { metadataURI, setMetadataURI, register, result } = useAgentRegistry();
  return <div className="space-y-2"><h2>Register Agent</h2><input value={metadataURI} onChange={(e)=>setMetadataURI(e.target.value)} placeholder="ipfs://metadata"/><button onClick={register}>Pay + Register</button><p>{result}</p></div>;
}
