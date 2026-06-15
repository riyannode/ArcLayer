/**
 * CanonicalDeliverableV1 — Provider deliverable schema for ERC-8183 settlement.
 *
 * Encodes task output, artifacts, and runtime receipt into a deterministic
 * canonical payload whose Keccak-256 hash matches the on-chain deliverableHash.
 *
 * Design:
 *   - Deterministic canonical JSON (sorted keys at every level)
 *   - Maximum payload: 1 MB
 *   - Maximum 32 artifacts
 *   - No secrets, no binary blobs
 *   - Provider cannot overwrite another provider
 *   - Immutable after Submitted
 *   - ERC-8183 hash: keccak256(exact canonical UTF-8 payload)
 *   - SHA-256 may be used only for individual file/artifact integrity
 */

import { z } from "zod";
import { keccak256, toBytes, type Hex } from "viem";

// ── Schemas ────────────────────────────────────────────────────────────────

const ArtifactSchema = z.object({
  name: z.string().min(1).max(256),
  uri: z.string().url().max(2048).optional(),
  contentType: z.string().min(1).max(128).optional(),
  sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
});

const RuntimeReceiptSchema = z.object({
  taskId: z.string().min(1).max(256),
  completedAt: z.string().datetime({ offset: true }),
});

/**
 * CanonicalDeliverableV1 — the canonical deliverable format.
 *
 * This is what gets hashed with Keccak-256 for the on-chain `deliverableHash`.
 * The `schema` field MUST be "arclayer.deliverable" and `version` MUST be 1.
 */
export const CanonicalDeliverableV1Schema = z.object({
  schema: z.literal("arclayer.deliverable"),
  version: z.literal(1),

  jobId: z.string().min(1).max(128),
  providerAgentId: z.string().min(1).max(128),

  output: z.unknown(),

  artifacts: z.array(ArtifactSchema).max(32),

  runtime: RuntimeReceiptSchema,
});

export type CanonicalDeliverableV1 = z.infer<typeof CanonicalDeliverableV1Schema>;

export type DeliverableArtifact = z.infer<typeof ArtifactSchema>;

export type RuntimeReceipt = z.infer<typeof RuntimeReceiptSchema>;

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MB
const MAX_ARTIFACTS = 32;

const DELIVERABLE_SCHEMA = "arclayer.deliverable";
const DELIVERABLE_VERSION = 1;

// ── Canonical JSON ─────────────────────────────────────────────────────────

/**
 * Deterministic JSON serialization.
 * Recursively sorts all object keys at every nesting level.
 * Ensures the same logical deliverable always produces the same bytes.
 */
function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const pairs = keys.map(
      (k) => JSON.stringify(k) + ":" + canonicalStringify((value as Record<string, unknown>)[k]),
    );
    return "{" + pairs.join(",") + "}";
  }
  return String(value);
}

// ── Canonicalize ───────────────────────────────────────────────────────────

/**
 * Canonicalize a deliverable into a deterministic JSON string.
 *
 * Validates against the schema, then serializes with sorted keys.
 * Returns the UTF-8 string that will be Keccak-256 hashed for on-chain use.
 *
 * @throws if validation fails or payload exceeds MAX_PAYLOAD_BYTES
 */
export function canonicalizeDeliverable(deliverable: CanonicalDeliverableV1): string {
  const validated = CanonicalDeliverableV1Schema.parse(deliverable);

  // Artifact count check (defense-in-depth beyond zod)
  if (validated.artifacts.length > MAX_ARTIFACTS) {
    throw new Error(
      `Deliverable has ${validated.artifacts.length} artifacts, maximum is ${MAX_ARTIFACTS}`,
    );
  }

  const canonical = canonicalStringify(validated);

  const byteLength = Buffer.byteLength(canonical, "utf-8");
  if (byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `Deliverable payload ${byteLength} bytes exceeds maximum ${MAX_PAYLOAD_BYTES} bytes`,
    );
  }

  return canonical;
}

// ── ERC-8183 Deliverable Hash ──────────────────────────────────────────────

/**
 * Compute the ERC-8183 deliverable hash from a canonical payload string.
 *
 * Uses Keccak-256 as required by the Arc AgenticCommerce contract.
 * The input MUST be the exact canonical UTF-8 bytes from canonicalizeDeliverable().
 *
 * ⚠️ Do NOT use SHA-256 for the on-chain hash. SHA-256 may be used only
 * for individual artifact integrity (see ArtifactSchema.sha256).
 */
export function computeErc8183DeliverableHash(canonicalPayload: string): Hex {
  return keccak256(toBytes(canonicalPayload));
}

/**
 * Convenience: canonicalize + hash in one call.
 */
export function hashDeliverable(deliverable: CanonicalDeliverableV1): {
  canonicalPayload: string;
  deliverableHash: Hex;
} {
  const canonicalPayload = canonicalizeDeliverable(deliverable);
  const deliverableHash = computeErc8183DeliverableHash(canonicalPayload);
  return { canonicalPayload, deliverableHash };
}

// ── Verify ─────────────────────────────────────────────────────────────────

/**
 * Verify that a canonical payload produces the expected ERC-8183 deliverable hash.
 *
 * Used by:
 *   - Hosted MCP evaluator.get_deliverable (three-way hash check)
 *   - Evaluator worker (hash verification before evaluation)
 *   - Reconciliation (hash consistency checks)
 *
 * @returns true if the computed hash matches the expected hash
 */
export function verifyErc8183DeliverableHash(
  canonicalPayload: string,
  expectedHash: Hex,
): boolean {
  const computed = computeErc8183DeliverableHash(canonicalPayload);
  return computed.toLowerCase() === expectedHash.toLowerCase();
}

// ── Decode (for evaluator use) ─────────────────────────────────────────────

/**
 * Decode a canonical payload string back into a CanonicalDeliverableV1.
 *
 * Used by the evaluator worker to inspect deliverable contents after
 * receiving the canonical payload from the Hosted MCP.
 */
export function decodeDeliverable(canonicalPayload: string): CanonicalDeliverableV1 | null {
  if (!canonicalPayload || typeof canonicalPayload !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalPayload);
  } catch {
    return null;
  }

  const result = CanonicalDeliverableV1Schema.safeParse(parsed);
  if (!result.success) return null;

  return result.data;
}

// ── Guards ─────────────────────────────────────────────────────────────────

/**
 * Check if a string is a canonical deliverable (vs unstructured output).
 */
export function isCanonicalDeliverable(raw: string): boolean {
  if (!raw || typeof raw !== "string") return false;
  try {
    const parsed = JSON.parse(raw);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      parsed.schema === DELIVERABLE_SCHEMA &&
      parsed.version === DELIVERABLE_VERSION
    );
  } catch {
    return false;
  }
}
