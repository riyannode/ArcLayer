/**
 * Identity ensure — ERC-8004 identity registration state management.
 *
 * Manages crash-safe identity state in:
 *   ~/.arclayer/runner/identity.json          — confirmed identity
 *   ~/.arclayer/runner/identity-registration.json — pending registration
 *   ~/.arclayer/runner/identity.lock           — prevents concurrent mint
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ──────────────────────────────────────────────────────────────────

export type IdentityState = {
  status: "confirmed" | "pending" | "none";
  tokenId?: string;
  walletAddress?: string;
  metadataURI?: string;
  txHash?: string;
  registeredAt?: string;
  confirmedAt?: string;
};

export type RegistrationState = {
  status: "submitted" | "confirmed" | "failed";
  txHash?: string;
  metadataURI?: string;
  walletAddress?: string;
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

// ── Lock Management ────────────────────────────────────────────────────────

export function acquireLock(): boolean {
  const path = getLockPath();
  if (existsSync(path)) {
    // Check if lock is stale (> 10 minutes old)
    try {
      const stat = require("node:fs").statSync(path);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > 10 * 60 * 1000) {
        // Stale lock, remove it
        require("node:fs").unlinkSync(path);
      } else {
        return false;
      }
    } catch {
      return false;
    }
  }
  writeFileSync(path, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), "utf8");
  return true;
}

export function releaseLock(): void {
  const path = getLockPath();
  try {
    if (existsSync(path)) {
      require("node:fs").unlinkSync(path);
    }
  } catch {
    // Best effort
  }
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
  action: "already_confirmed" | "already_pending" | "registered" | "failed";
  identity: IdentityState;
  message: string;
};

export async function ensureIdentity(params: {
  agentName: string;
  role: string;
  description?: string;
  capabilities?: string;
  autoRegister: boolean;
  registerFn: (metadataURI: string) => Promise<{ ok: boolean; txHash?: string; result?: unknown }>;
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

  // Check for pending registration
  const pending = readRegistrationState();
  if (pending && pending.status === "submitted" && pending.txHash) {
    return {
      action: "already_pending",
      identity: { ...existing, status: "pending", txHash: pending.txHash },
      message: `Registration pending: txHash=${pending.txHash}. Re-run after tx confirms.`,
    };
  }

  // Need to register
  if (!params.autoRegister) {
    return {
      action: "failed",
      identity: existing,
      message: "Identity not found. Run with --auto-register to mint.",
    };
  }

  // Acquire lock to prevent double-mint
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

    // Write pending state before calling register (crash-safe)
    writeRegistrationState({
      status: "submitted",
      metadataURI,
      submittedAt: new Date().toISOString(),
    });

    const result = await params.registerFn(metadataURI);

    if (!result.ok) {
      writeRegistrationState({
        status: "failed",
        metadataURI,
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
      submittedAt: new Date().toISOString(),
    });

    // Write identity as pending (will be confirmed on next run)
    writeIdentityState({
      status: "pending",
      walletAddress: undefined, // filled by caller
      metadataURI,
      txHash: result.txHash,
      registeredAt: new Date().toISOString(),
    });

    return {
      action: "registered",
      identity: {
        status: "pending",
        metadataURI,
        txHash: result.txHash,
        registeredAt: new Date().toISOString(),
      },
      message: `Registration submitted: txHash=${result.txHash}. Re-run after tx confirms to finalize.`,
    };
  } finally {
    releaseLock();
  }
}
