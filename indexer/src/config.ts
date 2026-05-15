export const INDEXER_PORT = Number(process.env.INDEXER_PORT || process.env.PORT || 3535);
export const DEFAULT_FROM_BLOCK = BigInt(process.env.FROM_BLOCK || "41752050");
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5_000);
export const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
export const DATABASE_PATH = process.env.DATABASE_PATH || "";
// Per-chunk block range for eth_getLogs. Arc testnet supports 10k; some
// public RPCs (Alchemy/Infura) cap lower at 2k/5k. Override via env.
export const MAX_BLOCK_RANGE = BigInt(process.env.MAX_BLOCK_RANGE || 10_000);
