export const INDEXER_PORT = Number(process.env.INDEXER_PORT || process.env.PORT || 3535);
export const DEFAULT_FROM_BLOCK = BigInt(process.env.FROM_BLOCK || '41752050');
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30_000);
export const ARC_RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
export const DATABASE_PATH = process.env.DATABASE_PATH || '';
export const MAX_BLOCK_RANGE = BigInt(process.env.MAX_BLOCK_RANGE || 10_000);

export const ARC_ERC8004_ADDRESS = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const;
export const ARC_ERC8183_ADDRESS = '0x0747EEf0706327138c69792bF28Cd525089e4583' as const;

export const INDEX_ARC_REFERENCE_ERC8183 =
  (process.env.INDEX_ARC_REFERENCE_ERC8183 ?? 'true').toLowerCase() !== 'false';
export const INDEX_ARC_REFERENCE_ERC8004 =
  (process.env.INDEX_ARC_REFERENCE_ERC8004 ?? 'true').toLowerCase() !== 'false';

export const ARC_REFERENCE_WALLET_FILTER = (process.env.ARC_REFERENCE_WALLET_FILTER || '')
  .split(',').map((s) => s.trim().toLowerCase())
  .filter((s) => s.startsWith('0x') && s.length === 42);

export const ARC_REFERENCE_AGENT_ID_FILTER = (process.env.ARC_REFERENCE_AGENT_ID_FILTER || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

export const ARC_REFERENCE_METADATA_PREFIX_FILTER = (process.env.ARC_REFERENCE_METADATA_PREFIX_FILTER || 'arclayer://,https://arclayers.xyz')
  .split(',').map((s) => s.trim()).filter(Boolean);
