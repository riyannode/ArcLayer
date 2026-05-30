export const INDEXER_PORT = Number(process.env.INDEXER_PORT || process.env.PORT || 3535);
const fromBlockEnv = process.env.FROM_BLOCK ?? process.env.START_BLOCK ?? '41752050';
export const DEFAULT_FROM_BLOCK = BigInt(fromBlockEnv);

// ERC-8004 Identity Registry deployment / backfill start block.
export const IDENTITY_FROM_BLOCK = BigInt(
  process.env.IDENTITY_FROM_BLOCK || process.env.ERC8004_IDENTITY_FROM_BLOCK || fromBlockEnv,
);

export const REPUTATION_FROM_BLOCK = BigInt(
  process.env.REPUTATION_FROM_BLOCK || process.env.ERC8004_REPUTATION_FROM_BLOCK || fromBlockEnv,
);

export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30_000);
export const ARC_RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
export const DATABASE_PATH = process.env.DATABASE_PATH || '';
export const MAX_BLOCK_RANGE = BigInt(process.env.MAX_BLOCK_RANGE || 500);
export const INDEXER_DB_PATH = process.env.INDEXER_DB_PATH || '';

export const ARC_ERC8004_ADDRESS = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const;
export const ARC_ERC8183_ADDRESS = '0x0747EEf0706327138c69792bF28Cd525089e4583' as const;

export const ARC_ERC8004_REPUTATION_ADDRESS = '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const;

export const INDEX_ARC_REFERENCE_ERC8183 =
  (process.env.INDEX_ARC_REFERENCE_ERC8183 ?? 'true').toLowerCase() !== 'false';
export const INDEX_ARC_REFERENCE_ERC8004 =
  (process.env.INDEX_ARC_REFERENCE_ERC8004 ?? 'true').toLowerCase() !== 'false';

export const INDEX_ARC_REFERENCE_ERC8004_REPUTATION =
  (process.env.INDEX_ARC_REFERENCE_ERC8004_REPUTATION ?? 'true').toLowerCase() !== 'false';

export const ARC_REFERENCE_WALLET_FILTER = (process.env.ARC_REFERENCE_WALLET_FILTER || '')
  .split(',').map((s) => s.trim().toLowerCase())
  .filter((s) => s.startsWith('0x') && s.length === 42);

export const ARC_REFERENCE_AGENT_ID_FILTER = (process.env.ARC_REFERENCE_AGENT_ID_FILTER || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

export const ARC_REFERENCE_METADATA_PREFIX_FILTER = (process.env.ARC_REFERENCE_METADATA_PREFIX_FILTER || 'arclayer://,https://arclayers.xyz')
  .split(',').map((s) => s.trim()).filter(Boolean);

console.log(
  `[indexer] startup config fromBlock=${DEFAULT_FROM_BLOCK.toString()} identityFromBlock=${IDENTITY_FROM_BLOCK.toString()} reputationFromBlock=${REPUTATION_FROM_BLOCK.toString()} maxBlockRange=${MAX_BLOCK_RANGE.toString()} pollIntervalMs=${POLL_INTERVAL_MS} indexErc8183=${INDEX_ARC_REFERENCE_ERC8183} indexErc8004=${INDEX_ARC_REFERENCE_ERC8004} indexReputation=${INDEX_ARC_REFERENCE_ERC8004_REPUTATION} indexerDbPath=${INDEXER_DB_PATH || '(default)'}`,
);
