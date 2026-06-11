import { createHash } from "node:crypto";
import { keccak256, toBytes } from "viem";

export function sha256Json(value: unknown): string {
  const json = JSON.stringify(value, Object.keys(value as object).sort());
  return createHash("sha256").update(json).digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function erc8183Hash(value: unknown): `0x${string}` {
  const payload = typeof value === "string" ? value : JSON.stringify(value);
  return keccak256(toBytes(payload));
}
