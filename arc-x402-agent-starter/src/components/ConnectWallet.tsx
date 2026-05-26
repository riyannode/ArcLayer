"use client";

import { useArcWallet } from "@/hooks/useArcWallet";

export function ConnectWallet() {
  const { address, isConnected, openConnect } = useArcWallet();
  return (
    <div className="space-y-2">
      <button onClick={openConnect}>{isConnected ? "Connected" : "Connect Wallet"}</button>
      <p>{address ?? "Not connected"}</p>
    </div>
  );
}
