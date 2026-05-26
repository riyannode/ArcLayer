"use client";
import { useState } from "react";
export function useArcWallet() {
  const [address, setAddress] = useState<string>();
  return { address, connectMock: () => setAddress("0x1234...abcd") };
}
