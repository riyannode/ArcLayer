"use client";
import { useArcWallet } from "@/hooks/useArcWallet";
export function ConnectWallet() {
  const { address, connectMock } = useArcWallet();
  return <div className="space-y-2"><button onClick={connectMock}>{address ? "Connected" : "Connect Wallet (demo)"}</button><p>{address ?? "Not connected"}</p></div>;
}
