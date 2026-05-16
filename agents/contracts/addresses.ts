// A2A Protocol Contract Addresses — Arc Testnet (chainId 5042002)
// Deployed: 2026-05-16

export const A2A_CONTRACTS = {
  A2AAgentRegistry: '0xB263336055dD65FF501e36CA39941760D943703C',
  A2AReputationRegistry: '0x9c97CAE866397d94e295632B3BFCF342ea20f1Cc',
  A2AReceiptRegistry: '0x5F591465D0C2fe20A28D2539dFBB2B00716397B7',
  MarketMirrorRegistry: '0xec5910926925941c451C97A8bd2c4Ba7bD173195',
} as const;

// Existing contracts
export const EXISTING_CONTRACTS = {
  Ignia: '0xd66971F9Da4c60DB4A061686F43dBf39Db5E2916',
  USDC: '0x3600000000000000000000000000000000000000',
} as const;

// Agent addresses
export const AGENTS = {
  admin: '0x51a6e681f5a74A65dD853Dc21d9ffF4A5341514e',
  pythia: '0x3DC78013A70d9E0d1047902f5DCB50aeF68B003b',
  hermes: '0x8fafCF61AA3E429EE6627b2a5a3FFAEc6B51A528',
} as const;

export const ARC_TESTNET = {
  chainId: 5042002,
  rpc: 'https://rpc.drpc.testnet.arc.network',
  name: 'Arc Testnet',
} as const;
