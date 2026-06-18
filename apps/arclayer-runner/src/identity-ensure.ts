/**
 * Identity ensure — ERC-8004 identity registration state management.
 *
 * Manages crash-safe identity state in:
 *   ~/.arclayer/runner/identity.json          — confirmed identity
 *   ~/.arclayer/runner/identity-registration.json — pending registration
 *   ~/.arclayer/runner/identity.lock           — prevents concurrent mint
 *
 * Changes from previous version:
 *   - ESM-safe: all fs imports at top, no dynamic require()
 *   - Atomic lock: exclusive openSync("wx") prevents race conditions
 *   - IdempotencyKey: stable key for identity mint, stored in registration state
 *   - Finalize pending: can check tx receipt and confirm tokenId
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  statSync,
  unlinkSync,
  openSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────────

export type IdentityState = {
  status: "confirmed" | "pending" | "none";
  tokenId?: string;
  walletAddress?: string;
  metadataURI?: string;
  txHash?: string;
  idempotencyKey?: string;
  registeredAt?: string;
  confirmedAt?: string;
};

export type RegistrationState = {
  status: "submitted" | "confirmed" | "failed";
  txHash?: string;
  metadataURI?: string;
  walletAddress?: string;
  idempotencyKey?: string;
  submittedAt: string;
  confirmedAt?: string;
  error?: string;
};

// ── Paths ──────────────────────────────────────────────────────────────────

export function getIdentityDir(): string {
  const dir = join(homedir(), ".arclayer", "runner");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getIdentityPath(): string {
  return join(getIdentityDir(), "identity.json");
}

export function getRegistrationPath(): string {
  return join(getIdentityDir(), "identity-registration.json");
}

export function getLockPath(): string {
  return join(getIdentityDir(), "identity.lock");
}

// ── State Read ─────────────────────────────────────────────────────────────

export function readIdentityState(): IdentityState {
  const path = getIdentityPath();
  if (!existsSync(path)) {
    return { status: "none" };
  }
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as IdentityState;
  } catch {
    return { status: "none" };
  }
}

export function readRegistrationState(): RegistrationState | null {
  const path = getRegistrationPath();
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as RegistrationState;
  } catch {
    return null;
  }
}

// ── State Write (crash-safe via rename) ────────────────────────────────────

export function writeIdentityState(state: IdentityState): void {
  const path = getIdentityPath();
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  renameSync(tmpPath, path);
}

export function writeRegistrationState(state: RegistrationState): void {
  const path = getRegistrationPath();
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  renameSync(tmpPath, path);
}

// ── ESM-Safe Atomic Lock Management ────────────────────────────────────────
//
// Uses exclusive file creation (openSync "wx") to prevent two processes
// from acquiring the lock simultaneously. No dynamic require() calls.
// Stale locks (> 10 minutes) are removed and retried once.

const STALE_LOCK_MS = 10 * 60 * 1000; // 10 minutes

export function acquireLock(): boolean {
  const lockPath = getLockPath();

  // First attempt: exclusive create
  if (tryExclusiveAcquire(lockPath)) {
    return true;
  }

  // Lock exists — check if stale
  try {
    const stat = statSync(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > STALE_LOCK_MS) {
      // Stale lock, remove and retry once
      try {
        unlinkSync(lockPath);
      } catch {
        // Another process may have removed it — fine
      }
      return tryExclusiveAcquire(lockPath);
    }
  } catch {
    // stat failed — lock may have been removed between check and stat
    return tryExclusiveAcquire(lockPath);
  }

  return false;
}

function tryExclusiveAcquire(lockPath: string): boolean {
  try {
    const fd = openSync(lockPath, "wx"); // exclusive create — fails if exists
    const content = JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() });
    writeFileSync(fd, content, "utf8");
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export function releaseLock(): void {
  const lockPath = getLockPath();
  try {
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  } catch {
    // Best effort
  }
}

// ── Idempotency Key ────────────────────────────────────────────────────────
//
// Generate a stable idempotency key tied to wallet address + metadataURI.
// Uses keccak256-like pattern: sha256 of wallet+metadataURI.
// Same key is reused on rerun to prevent duplicate registration.

export function generateIdempotencyKey(walletAddress: string, metadataURI: string): string {
  const hash = createHash("sha256")
    .update(`${walletAddress.toLowerCase()}:${metadataURI}`)
    .digest("hex");
  return `erc8004-register:${walletAddress.toLowerCase()}:${hash}`;
}

// ── Metadata URI Builder ───────────────────────────────────────────────────

export function buildMetadataURI(params: {
  agentName: string;
  role: string;
  description?: string;
  capabilities?: string;
}): string {
  const metadata: Record<string, unknown> = {
    name: params.agentName,
    role: params.role,
    version: 1,
  };
  if (params.description) metadata.description = params.description;
  if (params.capabilities) metadata.capabilities = params.capabilities.split(",").map((s) => s.trim());

  // Use data: URI for on-chain metadata (no external hosting dependency)
  const json = JSON.stringify(metadata);
  return `data:application/json;base64,${Buffer.from(json, "utf8").toString("base64")}`;
}

// ── Ensure Logic ───────────────────────────────────────────────────────────

export type EnsureResult = {
  action: "already_confirmed" | "already_pending" | "registered" | "confirmed_pending" | "failed";
  identity: IdentityState;
  message: string;
};

export type FinalizeResult = {
  action: "confirmed" | "still_pending" | "reverted" | "not_found";
  tokenId?: string;
  message: string;
};

/**
 * Check if a pending tx has been finalized.
 * Returns confirmed with tokenId if tx succeeded and tokenId can be extracted.
 * Returns still_pending if tx not yet mined.
 * Returns reverted if tx reverted.
 * Returns not_found if tx hash is not found.
 *
 * The finalizeFn is injected by the caller (runner CLI) to avoid coupling
 * to a specific chain query mechanism.
 */
export async function finalizePendingIdentity(params: {
  finalizeFn: (txHash: string) => Promise<{
    status: "confirmed" | "still_pending" | "reverted" | "not_found";
    tokenId?: string;
  }>;
}): Promise<FinalizeResult> {
  const registration = readRegistrationState();
  if (!registration || registration.status !== "submitted" || !registration.txHash) {
    return { action: "not_found", message: "No pending registration to finalize" };
  }

  const result = await params.finalizeFn(registration.txHash);

  if (result.status === "confirmed" && result.tokenId) {
    // Write confirmed identity
    writeIdentityState({
      status: "confirmed",
      tokenId: result.tokenId,
      walletAddress: registration.walletAddress,
      metadataURI: registration.metadataURI,
      txHash: registration.txHash,
      idempotencyKey: registration.idempotencyKey,
      registeredAt: registration.submittedAt,
      confirmedAt: new Date().toISOString(),
    });

    // Update registration state
    writeRegistrationState({
      ...registration,
      status: "confirmed",
      confirmedAt: new Date().toISOString(),
    });

    return {
      action: "confirmed",
      tokenId: result.tokenId,
      message: `Identity confirmed: tokenId=${result.tokenId}`,
    };
  }

  if (result.status === "reverted") {
    writeRegistrationState({
      ...registration,
      status: "failed",
      error: "Transaction reverted on-chain",
    });
    return {
      action: "reverted",
      message: `Registration tx reverted: txHash=${registration.txHash}`,
    };
  }

  // still_pending or not_found
  return {
    action: result.status,
    message: `Tx ${registration.txHash} status: ${result.status}`,
  };
}

export async function ensureIdentity(params: {
  agentName: string;
  role: string;
  description?: string;
  capabilities?: string;
  autoRegister: boolean;
  walletAddress?: string;
  registerFn: (metadataURI: string, idempotencyKey: string) => Promise<{ ok: boolean; txHash?: string; result?: unknown }>;
  /** If provided, attempt to finalize pending registrations */
  finalizeFn?: (txHash: string) => Promise<{
    status: "confirmed" | "still_pending" | "reverted" | "not_found";
    tokenId?: string;
  }>;
}): Promise<EnsureResult> {
  const existing = readIdentityState();

  // Already confirmed
  if (existing.status === "confirmed" && existing.tokenId) {
    return {
      action: "already_confirmed",
      identity: existing,
      message: `Identity already confirmed: tokenId=${existing.tokenId}`,
    };
  }

  // Check for pending registration — attempt to finalize if finalizeFn provided
  const pending = readRegistrationState();
  if (pending && pending.status === "submitted" && pending.txHash) {
    // Try to finalize pending tx
    if (params.finalizeFn) {
      const finalizeResult = await finalizePendingIdentity({ finalizeFn: params.finalizeFn });

      if (finalizeResult.action === "confirmed" && finalizeResult.tokenId) {
        return {
          action: "confirmed_pending",
          identity: readIdentityState(), // re-read after finalize wrote
          message: finalizeResult.message,
        };
      }

      if (finalizeResult.action === "reverted") {
        // Tx reverted — fall through to re-register if autoRegister
        // (Don't return, let it proceed to re-register below)
      } else {
        // still_pending or not_found
        return {
          action: "already_pending",
          identity: { ...existing, status: "pending", txHash: pending.txHash },
          message: finalizeResult.message,
        };
      }
    } else {
      // No finalizeFn — just report pending
      return {
        action: "already_pending",
        identity: { ...existing, status: "pending", txHash: pending.txHash },
        message: `Registration pending: txHash=${pending.txHash}. Re-run after tx confirms.`,
      };
    }
  }

  // Need to register
  if (!params.autoRegister) {
    return {
      action: "failed",
      identity: existing,
      message: "Identity not found. Run with --auto-register to mint.",
    };
  }

  // Acquire lock to prevent double-mint (atomic exclusive create)
  if (!acquireLock()) {
    return {
      action: "failed",
      identity: existing,
      message: "Could not acquire identity lock. Another registration may be in progress.",
    };
  }

  try {
    const metadataURI = buildMetadataURI({
      agentName: params.agentName,
      role: params.role,
      description: params.description,
      capabilities: params.capabilities,
    });

    // Generate stable idempotency key
    const walletAddress = params.walletAddress ?? "";
    const idempotencyKey = generateIdempotencyKey(walletAddress, metadataURI);

    // Write pending state before calling register (crash-safe)
    writeRegistrationState({
      status: "submitted",
      metadataURI,
      walletAddress,
      idempotencyKey,
      submittedAt: new Date().toISOString(),
    });

    const result = await params.registerFn(metadataURI, idempotencyKey);

    if (!result.ok) {
      writeRegistrationState({
        status: "failed",
        metadataURI,
        walletAddress,
        idempotencyKey,
        submittedAt: new Date().toISOString(),
        error: "Registration returned ok=false",
      });
      return {
        action: "failed",
        identity: { status: "none" },
        message: "Registration failed: wallet adapter returned ok=false",
      };
    }

    // Update registration with txHash
    writeRegistrationState({
      status: "submitted",
      txHash: result.txHash,
      metadataURI,
      walletAddress,
      idempotencyKey,
      submittedAt: new Date().toISOString(),
    });

    // Write identity as pending (will be confirmed on next run)
    writeIdentityState({
      status: "pending",
      walletAddress,
      metadataURI,
      txHash: result.txHash,
      idempotencyKey,
      registeredAt: new Date().toISOString(),
    });

    return {
      action: "registered",
      identity: {
        status: "pending",
        walletAddress,
        metadataURI,
        txHash: result.txHash,
        idempotencyKey,
        registeredAt: new Date().toISOString(),
      },
      message: `Registration submitted: txHash=${result.txHash}. Re-run after tx confirms to finalize.`,
    };
  } finally {
    releaseLock();
  }
}
