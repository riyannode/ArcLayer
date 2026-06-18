/**
 * Identity ensure — ERC-8004 identity registration state management.
 *
 * Manages crash-safe identity state in:
 *   ~/.arclayer/runner/identity.json          — confirmed identity
 *   ~/.arclayer/runner/identity-registration.json — pending registration
 *   ~/.arclayer/runner/identity.lock           — prevents concurrent mint
 *
 * Read-first flow:
 *   1. Check local identity.json
 *   2. Check on-chain balanceOf(wallet) + ownerOf scan
 *   3. Optionally check Console erc8004_agents roster
 *   4. If identity exists → reuse, do not mint
 *   5. If none → auto-register (if --auto-register)
 *   6. If multiple → require explicit ARCLAYER_AGENT_ID
 *   7. If second mint → require --confirm-second-mint
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
import { createHash, randomUUID } from "node:crypto";

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

export type OnChainIdentity = {
  tokenId: string;
  owner: string;
};

export type ConsoleRosterEntry = {
  token_id: string;
  agent_id?: string;
  controller?: string;
  owner?: string;
  metadata_json?: Record<string, unknown>;
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

const STALE_LOCK_MS = 10 * 60 * 1000; // 10 minutes

export function acquireLock(): boolean {
  const lockPath = getLockPath();

  if (tryExclusiveAcquire(lockPath)) {
    return true;
  }

  try {
    const stat = statSync(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > STALE_LOCK_MS) {
      try {
        unlinkSync(lockPath);
      } catch {
        // Another process may have removed it
      }
      return tryExclusiveAcquire(lockPath);
    }
  } catch {
    return tryExclusiveAcquire(lockPath);
  }

  return false;
}

function tryExclusiveAcquire(lockPath: string): boolean {
  try {
    const fd = openSync(lockPath, "wx");
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

/**
 * Generate a stable ArcLayer-internal idempotency key.
 * Format: erc8004-register:<wallet>:<sha256>
 */
export function generateIdempotencyKey(walletAddress: string, metadataURI: string): string {
  const hash = createHash("sha256")
    .update(`${walletAddress.toLowerCase()}:${metadataURI}`)
    .digest("hex");
  return `erc8004-register:${walletAddress.toLowerCase()}:${hash}`;
}

/**
 * Map ArcLayer internal idempotency key to UUID format for Circle API.
 * Circle SDK requires UUID-format idempotency keys.
 * Deterministic: same input → same UUID.
 */
export function mapToCircleIdempotencyKey(arclayerKey: string): string {
  // Generate deterministic UUID from ArcLayer key
  const hash = createHash("sha256").update(arclayerKey).digest("hex");
  // Format as UUID: 8-4-4-4-12
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

// ── On-Chain Identity Scan ─────────────────────────────────────────────────

/**
 * Check if a wallet already has ERC-8004 identity on-chain.
 * Uses viem public client — no private keys, read-only.
 *
 * Calls balanceOf(wallet) first, then scans ownerOf from totalSupply backwards.
 * Returns array of tokenIds owned by the wallet.
 */
export async function scanExistingIdentityOnChain(
  walletAddress: string,
  _viemOverride?: { balanceOf: (addr: string) => Promise<bigint>; ownerOf: (id: bigint) => Promise<string>; totalSupply: () => Promise<bigint> },
): Promise<OnChainIdentity[]> {
  const wallet = walletAddress.toLowerCase();

  let readFns: { balanceOf: (addr: string) => Promise<bigint>; ownerOf: (id: bigint) => Promise<string>; totalSupply: () => Promise<bigint> };

  if (_viemOverride) {
    readFns = _viemOverride;
  } else {
    const { createPublicClient, http, getContract, parseAbi } = await import("viem");

    const arcTestnet = {
      id: 5042002,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
    } as const;

    const client = createPublicClient({ chain: arcTestnet, transport: http() });
    const { CONTRACTS } = await import("@arclayer/sdk");

    const registry = getContract({
      address: CONTRACTS.ERC8004_IDENTITY_REGISTRY as `0x${string}`,
      abi: parseAbi([
        "function balanceOf(address account) view returns (uint256)",
        "function ownerOf(uint256 tokenId) view returns (address)",
        "function totalSupply() view returns (uint256)",
      ]),
      client,
    });

    readFns = {
      balanceOf: (addr: string) => registry.read.balanceOf([addr as `0x${string}`]),
      ownerOf: (id: bigint) => registry.read.ownerOf([id]),
      totalSupply: () => registry.read.totalSupply(),
    };
  }

  const balance = await readFns.balanceOf(wallet);
  if (balance === 0n) {
    return [];
  }

  const totalSupply = await readFns.totalSupply();
  const found: OnChainIdentity[] = [];

  for (let i = totalSupply; i > 0n && found.length < Number(balance); i--) {
    try {
      const owner = await readFns.ownerOf(i);
      if (owner.toLowerCase() === wallet) {
        found.push({ tokenId: i.toString(), owner: owner.toLowerCase() });
      }
    } catch {
      // Burned or invalid tokenId, skip
    }
  }

  return found;
}

// ── Console Roster Check ───────────────────────────────────────────────────

/**
 * Check Console erc8004_agents for existing identity owned by this wallet.
 * Returns matching entries from the roster.
 */
export async function checkConsoleRoster(
  walletAddress: string,
  consoleUrl: string,
  syncSecret: string,
  _fetchImpl?: typeof fetch,
): Promise<ConsoleRosterEntry[]> {
  const fetchFn = _fetchImpl ?? fetch;
  const wallet = walletAddress.toLowerCase();

  try {
    // Query erc8004_agents filtered by controller/owner
    const url = `${consoleUrl}/api/erc8004/agents?controller=${encodeURIComponent(wallet)}`;
    const resp = await fetchFn(url, {
      headers: {
        "Authorization": `Bearer ${syncSecret}`,
        "x-arclayer-runner-sync-secret": syncSecret,
      },
    });

    if (!resp.ok) {
      // Console may not have this endpoint — non-fatal
      return [];
    }

    const data = await resp.json() as { agents?: ConsoleRosterEntry[]; ok?: boolean };
    if (!data.ok || !Array.isArray(data.agents)) {
      return [];
    }

    return data.agents.filter((a) => {
      const ctrl = (a.controller ?? "").toLowerCase();
      const own = (a.owner ?? "").toLowerCase();
      return ctrl === wallet || own === wallet;
    });
  } catch {
    // Console unreachable — non-fatal, fall through to on-chain check
    return [];
  }
}

// ── Metadata URI Builder ───────────────────────────────────────────────────

/**
 * Build ERC-8004 metadata URI with dashboard roster fields.
 * Uses data: URI for on-chain metadata (no external hosting dependency).
 */
export function buildMetadataURI(params: {
  agentName: string;
  role: string;
  description?: string;
  capabilities?: string;
  endpoint?: string;
  mcpEndpoint?: string;
}): string {
  const capabilities = params.capabilities
    ? params.capabilities.split(",").map((s) => s.trim()).filter(Boolean)
    : ["erc8183", "langchain", "x402", "circle-dev-wallet"];

  const metadata: Record<string, unknown> = {
    schema: "arclayer.agent/v1",
    name: params.agentName,
    role: params.role,
    description: params.description ?? "",
    capabilities,
    categories: ["agentic-commerce", params.role],
    autonomous: true,
    x402: "enabled",
  };

  if (params.endpoint) metadata.endpoint = params.endpoint;
  if (params.mcpEndpoint) metadata.mcp = params.mcpEndpoint;

  const json = JSON.stringify(metadata);
  return `data:application/json;base64,${Buffer.from(json, "utf8").toString("base64")}`;
}

// ── Ensure Logic ───────────────────────────────────────────────────────────

export type EnsureResult = {
  action: "already_confirmed" | "already_pending" | "registered" | "confirmed_pending" | "confirmed_onchain" | "confirmed_console" | "failed";
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
 */
export async function finalizePendingIdentity(params: {
  finalizeFn: (txHash: string, metadataURI?: string) => Promise<{
    status: "confirmed" | "still_pending" | "reverted" | "not_found";
    tokenId?: string;
  }>;
}): Promise<FinalizeResult> {
  const registration = readRegistrationState();
  if (!registration || registration.status !== "submitted" || !registration.txHash) {
    return { action: "not_found", message: "No pending registration to finalize" };
  }

  const result = await params.finalizeFn(registration.txHash, registration.metadataURI);

  if (result.status === "confirmed" && result.tokenId) {
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
  endpoint?: string;
  mcpEndpoint?: string;
  autoRegister: boolean;
  confirmSecondMint?: boolean;
  walletAddress?: string;
  consoleUrl?: string;
  syncSecret?: string;
  registerFn: (metadataURI: string, idempotencyKey: string) => Promise<{ ok: boolean; txHash?: string; result?: unknown }>;
  finalizeFn?: (txHash: string, metadataURI?: string) => Promise<{
    status: "confirmed" | "still_pending" | "reverted" | "not_found";
    tokenId?: string;
  }>;
  syncToConsoleFn?: (txHash: string, controllerAddress: string, metadataURI: string, role: string, agentName: string) => Promise<{ ok: boolean; tokenId?: string; error?: string; retryable?: boolean }>;
  /** Override for on-chain reads (testing) */
  _onChainOverride?: { balanceOf: (addr: string) => Promise<bigint>; ownerOf: (id: bigint) => Promise<string>; totalSupply: () => Promise<bigint> };
  /** Override for console roster check (testing) */
  _consoleOverride?: typeof checkConsoleRoster;
}): Promise<EnsureResult> {
  // ── Step 1: Check local identity.json ──────────────────────────────────
  const existing = readIdentityState();

  if (existing.status === "confirmed" && existing.tokenId) {
    return {
      action: "already_confirmed",
      identity: existing,
      message: `Identity already confirmed: tokenId=${existing.tokenId}`,
    };
  }

  // ── Step 2: Check for pending registration ────────────────────────────
  const pending = readRegistrationState();
  if (pending && pending.status === "submitted" && pending.txHash) {
    if (params.finalizeFn) {
      const finalizeResult = await finalizePendingIdentity({ finalizeFn: params.finalizeFn });

      if (finalizeResult.action === "confirmed" && finalizeResult.tokenId) {
        return {
          action: "confirmed_pending",
          identity: readIdentityState(),
          message: finalizeResult.message,
        };
      }

      if (finalizeResult.action === "reverted") {
        // Tx reverted — fall through to re-register
      } else {
        return {
          action: "already_pending",
          identity: { ...existing, status: "pending", txHash: pending.txHash },
          message: finalizeResult.message,
        };
      }
    } else {
      return {
        action: "already_pending",
        identity: { ...existing, status: "pending", txHash: pending.txHash },
        message: `Registration pending: txHash=${pending.txHash}. Re-run after tx confirms.`,
      };
    }
  }

  // ── Step 3: Read-first — check on-chain for existing identity ─────────
  const walletAddress = params.walletAddress ?? "";
  if (!walletAddress) {
    return {
      action: "failed",
      identity: existing,
      message: "CIRCLE_WALLET_ADDRESS required for identity ensure",
    };
  }

  const short = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

  let onChainIdentities: OnChainIdentity[] = [];
  try {
    onChainIdentities = await scanExistingIdentityOnChain(walletAddress, params._onChainOverride);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Non-fatal — continue with other checks
    process.stderr.write(`[identity-ensure] On-chain scan failed (non-fatal): ${msg}\n`);
  }

  // ── Step 4: Optionally check Console roster ───────────────────────────
  let consoleEntries: ConsoleRosterEntry[] = [];
  if (params.consoleUrl && params.syncSecret) {
    const checkFn = params._consoleOverride ?? checkConsoleRoster;
    try {
      consoleEntries = await checkFn(walletAddress, params.consoleUrl, params.syncSecret);
    } catch {
      // Non-fatal
    }
  }

  // ── Step 5: Merge results — deduplicate by tokenId ────────────────────
  const tokenIdSet = new Set<string>();
  for (const id of onChainIdentities) tokenIdSet.add(id.tokenId);
  for (const entry of consoleEntries) tokenIdSet.add(entry.token_id);
  const allTokenIds = Array.from(tokenIdSet);

  // Case: exactly one identity found — reuse it
  if (allTokenIds.length === 1) {
    const tokenId = allTokenIds[0];
    const source = onChainIdentities.length > 0 ? "on-chain" : "console-roster";

    writeIdentityState({
      status: "confirmed",
      tokenId,
      walletAddress,
      confirmedAt: new Date().toISOString(),
    });

    process.stderr.write(`[identity-ensure] Found existing identity: wallet=${short} tokenId=${tokenId} source=${source}\n`);

    return {
      action: source === "on-chain" ? "confirmed_onchain" : "confirmed_console",
      identity: readIdentityState(),
      message: `Identity found (${source}): wallet=${short} tokenId=${tokenId}`,
    };
  }

  // Case: multiple identities — require explicit selection
  if (allTokenIds.length > 1) {
    process.stderr.write(`[identity-ensure] Multiple identities found for wallet ${short}: tokenIds=${allTokenIds.join(",")}\n`);
    process.stderr.write(`[identity-ensure] Set ARCLAYER_AGENT_ID explicitly in .env.runner\n`);

    return {
      action: "failed",
      identity: { status: "none" },
      message: `Multiple ERC-8004 identities found for wallet ${short}: tokenIds=${allTokenIds.join(",")}. Set ARCLAYER_AGENT_ID explicitly.`,
    };
  }

  // ── Step 6: No identity found — need to register ──────────────────────
  if (!params.autoRegister) {
    return {
      action: "failed",
      identity: existing,
      message: "No ERC-8004 identity found. Run with --auto-register to mint.",
    };
  }

  // Check if wallet already has on-chain identity (balance > 0) but scan missed it
  // This means the wallet has an identity but we couldn't find it — block second mint
  if (onChainIdentities.length === 0 && params.walletAddress) {
    // Double-check: if we have a pending registration with a txHash, the wallet may
    // already have a minted identity from a previous attempt
    const regState = readRegistrationState();
    if (regState && regState.txHash && regState.status === "submitted") {
      return {
        action: "already_pending",
        identity: { status: "pending", txHash: regState.txHash, walletAddress },
        message: `Previous registration pending: txHash=${regState.txHash}. Re-run after tx confirms.`,
      };
    }
  }

  // Second mint guard: if wallet already has identity, require --confirm-second-mint
  if (onChainIdentities.length > 0 && !params.confirmSecondMint) {
    const existingIds = onChainIdentities.map((id) => id.tokenId).join(",");
    process.stderr.write(`[identity-ensure] Wallet ${short} already has identity: tokenIds=${existingIds}\n`);
    process.stderr.write(`[identity-ensure] To mint a second identity, pass --confirm-second-mint\n`);

    return {
      action: "failed",
      identity: { status: "none" },
      message: `Wallet ${short} already has ERC-8004 identity: tokenIds=${existingIds}. Pass --confirm-second-mint to mint another.`,
    };
  }

  // ── Step 7: Acquire lock and register ─────────────────────────────────
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
      endpoint: params.endpoint,
      mcpEndpoint: params.mcpEndpoint,
    });

    // Generate stable ArcLayer idempotency key
    const arclayerKey = generateIdempotencyKey(walletAddress, metadataURI);

    // Write pending state before calling register (crash-safe)
    writeRegistrationState({
      status: "submitted",
      metadataURI,
      walletAddress,
      idempotencyKey: arclayerKey,
      submittedAt: new Date().toISOString(),
    });

    // Pass ArcLayer key to registerFn — services.ts will map to UUID for Circle
    const result = await params.registerFn(metadataURI, arclayerKey);

    if (!result.ok) {
      writeRegistrationState({
        status: "failed",
        metadataURI,
        walletAddress,
        idempotencyKey: arclayerKey,
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
      idempotencyKey: arclayerKey,
      submittedAt: new Date().toISOString(),
    });

    writeIdentityState({
      status: "pending",
      walletAddress,
      metadataURI,
      txHash: result.txHash,
      idempotencyKey: arclayerKey,
      registeredAt: new Date().toISOString(),
    });

    // ── Step 8: Sync to Console if syncToConsoleFn provided ─────────────
    if (params.syncToConsoleFn && result.txHash) {
      try {
        const syncResult = await params.syncToConsoleFn(
          result.txHash,
          walletAddress,
          metadataURI,
          params.role,
          params.agentName,
        );

        if (syncResult.ok && syncResult.tokenId) {
          // Sync succeeded — write confirmed identity
          writeIdentityState({
            status: "confirmed",
            tokenId: syncResult.tokenId,
            walletAddress,
            metadataURI,
            txHash: result.txHash,
            idempotencyKey: arclayerKey,
            registeredAt: new Date().toISOString(),
            confirmedAt: new Date().toISOString(),
          });

          writeRegistrationState({
            status: "confirmed",
            txHash: result.txHash,
            metadataURI,
            walletAddress,
            idempotencyKey: arclayerKey,
            submittedAt: new Date().toISOString(),
            confirmedAt: new Date().toISOString(),
          });

          return {
            action: "registered",
            identity: readIdentityState(),
            message: `Identity minted and synced: tokenId=${syncResult.tokenId} txHash=${result.txHash}`,
          };
        }

        if (syncResult.retryable) {
          // Tx not mined yet — return retryable
          return {
            action: "registered",
            identity: { status: "pending", walletAddress, metadataURI, txHash: result.txHash, idempotencyKey: arclayerKey, registeredAt: new Date().toISOString() },
            message: `Registration submitted: txHash=${result.txHash}. Sync pending (tx not mined). Re-run to finalize.`,
          };
        }

        // Sync failed permanently
        process.stderr.write(`[identity-ensure] Console sync failed: ${syncResult.error}\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[identity-ensure] Console sync error (non-fatal): ${msg}\n`);
      }
    }

    return {
      action: "registered",
      identity: {
        status: "pending",
        walletAddress,
        metadataURI,
        txHash: result.txHash,
        idempotencyKey: arclayerKey,
        registeredAt: new Date().toISOString(),
      },
      message: `Registration submitted: txHash=${result.txHash}. Re-run after tx confirms to finalize.`,
    };
  } finally {
    releaseLock();
  }
}
