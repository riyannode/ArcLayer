export const INDEXER_PORT = Number(process.env.INDEXER_PORT || process.env.PORT || 3535);
export const DEFAULT_FROM_BLOCK = BigInt(process.env.FROM_BLOCK || "41752050");
// Bumped from 5s to 30s — with 1671 jobs, a full sync cycle takes 10-20s.
// 5s interval guaranteed overlap → event loop starvation.
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30_000);

/**
 * Arc Testnet RPC endpoint (default: dRPC).
 *
 * Per Arc docs (https://docs.arc.io), canonical RPC is:
 *   https://rpc.testnet.arc.network
 *
 * We default to dRPC because it's been more stable for high-volume eth_getLogs
 * during indexer cold-syncs. Override via ARC_RPC_URL env if you need
 * canonical for SLA reasons. ArcLayer SDK ships ARC_RPC_URLS[] with both.
 */
export const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.drpc.testnet.arc.network";
export const DATABASE_PATH = process.env.DATABASE_PATH || "";
// Per-chunk block range for eth_getLogs. Arc testnet supports 10k; some
// public RPCs (Alchemy/Infura) cap lower at 2k/5k. Override via env.
export const MAX_BLOCK_RANGE = BigInt(process.env.MAX_BLOCK_RANGE || 10_000);

// ── Phase 6: Dual indexer toggles ──────────────────────────────────────────────

/**
 * Index official Arc ERC-8183 AgenticCommerce events alongside ArcLayer's own
 * JobEscrow events. Filtered by known ArcLayer wallets/agents to avoid noise.
 *
 * Default: true. Set to "false" to disable secondary indexing entirely.
 */
export const INDEX_ARC_REFERENCE_ERC8183 =
  (process.env.INDEX_ARC_REFERENCE_ERC8183 ?? "true").toLowerCase() !== "false";

/**
 * Comma-separated allowlist of wallet addresses (case-insensitive). Arc ERC-8183
 * jobs where client OR provider matches this list will be indexed. Provider
 * agents that registered via ArcLayer's AgentRegistry are auto-included.
 */
export const ARC_REFERENCE_WALLET_FILTER = (process.env.ARC_REFERENCE_WALLET_FILTER || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s.startsWith("0x") && s.length === 42);

/**
 * Official Arc ERC-8183 AgenticCommerce contract address (Circle reference impl).
 * Source: https://docs.arc.io
 */
export const ARC_ERC8183_ADDRESS = "0x0747EEf0706327138c69792bF28Cd525089e4583" as const;
