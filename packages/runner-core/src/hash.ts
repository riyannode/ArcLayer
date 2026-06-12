import { createHash } from "node:crypto";
import { keccak256, toBytes } from "viem";

/**
 * Deterministic JSON serialization for hashing.
 * Recursively sorts all object keys at every nesting level.
 * Handles nested objects, arrays, null, undefined.
 */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const pairs = keys.map(
      (k) => JSON.stringify(k) + ":" + canonicalJson((value as Record<string, unknown>)[k])
    );
    return "{" + pairs.join(",") + "}";
  }
  return String(value);
}

export function sha256Json(value: unknown): string {
  const json = canonicalJson(value);
  return createHash("sha256").update(json).digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function erc8183Hash(value: unknown): `0x${string}` {
  const payload = typeof value === "string" ? value : JSON.stringify(value);
  return keccak256(toBytes(payload));
}
