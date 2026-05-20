export const INDEXER_PORT = Number(process.env.INDEXER_PORT || process.env.PORT || 3535);
export const DEFAULT_FROM_BLOCK = BigInt(process.env.FROM_BLOCK || "41752050");
// Bumped from 5s to 30s — with 1671 jobs, a full sync cycle takes 10-20s.
// 5s interval guaranteed overlap → event loop starvation.
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30_000);

/**
 * Arc Testnet RPC endpoint (default: Circle canonical).
 *
 * Per Arc docs (https://docs.arc.io), canonical RPC is:
 *   https://rpc.testnet.arc.network
 *
 * Override via ARC_RPC_URL env if you need a specific provider.
 * Canonical is the source of truth for indexer reliability.
 */
export const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
export const DATABASE_PATH = process.env.DATABASE_PATH || "";
// Per-chunk block range for eth_getLogs. Arc testnet supports 10k; some
// public RPCs (Alchemy/Infura) cap lower at 2k/5k. Override via env.
export const MAX_BLOCK_RANGE = BigInt(process.env.MAX_BLOCK_RANGE || 10_000);

// ── Official Arc/Circle reference contracts (PRIMARY indexed surface) ───────

/**
 * Official ERC-8004 IdentityRegistry contract address (Circle reference impl).
 * Source: https://docs.arc.io/arc/references/contract-addresses.md
 */
export const ARC_ERC8004_ADDRESS = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;

/**
 * Official ERC-8183 AgenticCommerce contract address (Circle reference impl).
 * Source: https://docs.arc.io/arc/references/contract-addresses.md
 */
export const ARC_ERC8183_ADDRESS = "0x0747EEf0706327138c69792bF28Cd525089e4583" as const;

/**
 * Index official Arc ERC-8183 AgenticCommerce events.
 * Default: true (always on in 100% Arc/Circle reference mode).
 */
export const INDEX_ARC_REFERENCE_ERC8183 =
  (process.env.INDEX_ARC_REFERENCE_ERC8183 ?? "true").toLowerCase() !== "false";

/**
 * Index official Arc ERC-8004 IdentityRegistry Transfer events (registrations).
 * Default: true (always on in 100% Arc/Circle reference mode).
 */
export const INDEX_ARC_REFERENCE_ERC8004 =
  (process.env.INDEX_ARC_REFERENCE_ERC8004 ?? "true").toLowerCase() !== "false";

/**
 * Comma-separated allowlist of wallet addresses (case-insensitive).
 * If set, only ERC-8183 jobs where client OR provider matches will be indexed.
 * If empty (default), all jobs are indexed (full reference-mode coverage).
 */
export const ARC_REFERENCE_WALLET_FILTER = (process.env.ARC_REFERENCE_WALLET_FILTER || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s.startsWith("0x") && s.length === 42);

// ── Legacy ArcLayer custom contract toggles (deprecated) ────────────────────

/**
 * @deprecated Custom ArcLayer contracts (AgentRegistry / JobEscrow / WorkProof)
 * are disabled in 100% Arc/Circle reference mode. Default: false.
 * Only enable if you need to backfill legacy data.
 */
export const INDEX_LEGACY_ARCLAYER =
  (process.env.INDEX_LEGACY_ARCLAYER ?? "false").toLowerCase() === "true";
