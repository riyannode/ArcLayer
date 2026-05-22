// ABIs for A2A Protocol contracts
// Auto-generated from forge build output

export const A2A_AGENT_REGISTRY_ABI = [
  { type: 'function', name: 'registerAgent', inputs: [{ type: 'uint8', name: 'role' }, { type: 'string', name: 'endpoint' }, { type: 'string', name: 'metadataURI' }], outputs: [{ type: 'bytes32' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'updateAgent', inputs: [{ type: 'bytes32', name: 'agentId' }, { type: 'string', name: 'endpoint' }, { type: 'string', name: 'metadataURI' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'deactivateAgent', inputs: [{ type: 'bytes32', name: 'agentId' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getAgent', inputs: [{ type: 'bytes32', name: 'agentId' }], outputs: [{ type: 'tuple', name: '', components: [{ type: 'address', name: 'owner' }, { type: 'uint8', name: 'role' }, { type: 'string', name: 'endpoint' }, { type: 'string', name: 'metadataURI' }, { type: 'bool', name: 'active' }, { type: 'uint64', name: 'registeredAt' }, { type: 'bytes32', name: 'agentId' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getAgentsByRole', inputs: [{ type: 'uint8', name: 'role' }], outputs: [{ type: 'bytes32[]' }], stateMutability: 'view' },
  { type: 'function', name: 'getAgentsByOwner', inputs: [{ type: 'address', name: 'owner' }], outputs: [{ type: 'bytes32[]' }], stateMutability: 'view' },
  { type: 'function', name: 'exists', inputs: [{ type: 'bytes32', name: 'agentId' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'event', name: 'AgentRegistered', inputs: [{ type: 'bytes32', indexed: true, name: 'agentId' }, { type: 'address', indexed: true, name: 'owner' }, { type: 'uint8', indexed: true, name: 'role' }, { type: 'string', name: 'endpoint' }, { type: 'string', name: 'metadataURI' }] },
] as const;

export const A2A_REPUTATION_REGISTRY_ABI = [
  { type: 'function', name: 'recordInteraction', inputs: [{ type: 'bytes32', name: 'providerAgentId' }, { type: 'bytes32', name: 'buyerAgentId' }, { type: 'bytes32', name: 'receiptHash' }, { type: 'uint128', name: 'amount' }, { type: 'bool', name: 'delivered' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'recordSignalOutcome', inputs: [{ type: 'bytes32', name: 'providerAgentId' }, { type: 'bytes32', name: 'receiptHash' }, { type: 'bool', name: 'wasCorrect' }, { type: 'int128', name: 'pnlBps' }, { type: 'uint64', name: 'confidence' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'recordTraderOutcome', inputs: [{ type: 'bytes32', name: 'traderAgentId' }, { type: 'bytes32', name: 'receiptHash' }, { type: 'int128', name: 'pnlBps' }, { type: 'bool', name: 'executed' }, { type: 'bool', name: 'riskOk' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getReputation', inputs: [{ type: 'bytes32', name: 'agentId' }], outputs: [{ type: 'int128' }], stateMutability: 'view' },
  { type: 'function', name: 'getStats', inputs: [{ type: 'bytes32', name: 'agentId' }], outputs: [{ type: 'tuple', name: '', components: [{ type: 'uint64', name: 'callsServed' }, { type: 'uint64', name: 'callsFailed' }, { type: 'uint64', name: 'signalsCorrect' }, { type: 'uint64', name: 'signalsWrong' }, { type: 'int128', name: 'cumulativePnlBps' }, { type: 'uint64', name: 'calibrationScore' }, { type: 'uint128', name: 'totalRevenue' }, { type: 'int128', name: 'reputationScore' }] }], stateMutability: 'view' },
  { type: 'function', name: 'authorizeOracle', inputs: [{ type: 'address', name: 'oracle' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'revokeOracle', inputs: [{ type: 'address', name: 'oracle' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'authorizedOracles', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'event', name: 'InteractionRecorded', inputs: [{ type: 'bytes32', indexed: true, name: 'providerAgentId' }, { type: 'bytes32', indexed: true, name: 'buyerAgentId' }, { type: 'bytes32', name: 'receiptHash' }, { type: 'uint128', name: 'amount' }, { type: 'bool', name: 'delivered' }] },
  { type: 'event', name: 'SignalOutcomeRecorded', inputs: [{ type: 'bytes32', indexed: true, name: 'providerAgentId' }, { type: 'bytes32', name: 'receiptHash' }, { type: 'bool', name: 'wasCorrect' }, { type: 'int128', name: 'pnlBps' }, { type: 'uint64', name: 'confidence' }] },
  { type: 'event', name: 'TraderOutcomeRecorded', inputs: [{ type: 'bytes32', indexed: true, name: 'traderAgentId' }, { type: 'bytes32', name: 'receiptHash' }, { type: 'int128', name: 'pnlBps' }, { type: 'bool', name: 'executed' }, { type: 'bool', name: 'riskOk' }] },
] as const;

export const A2A_RECEIPT_REGISTRY_ABI = [
  { type: 'function', name: 'anchorReceipt', inputs: [{ type: 'tuple', name: 'r', components: [{ type: 'bytes32', name: 'providerAgentId' }, { type: 'bytes32', name: 'buyerAgentId' }, { type: 'bytes32', name: 'receiptHash' }, { type: 'bytes32', name: 'requestHash' }, { type: 'bytes32', name: 'responseHash' }, { type: 'bytes32', name: 'signalHash' }, { type: 'uint128', name: 'amount' }, { type: 'uint64', name: 'timestamp' }, { type: 'uint8', name: 'rail' }, { type: 'bytes32', name: 'paymentRef' }, { type: 'bytes32', name: 'tradeTx' }, { type: 'address', name: 'provider' }, { type: 'bool', name: 'exists' }] }, { type: 'bytes', name: 'providerSig' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getReceipt', inputs: [{ type: 'bytes32', name: 'receiptHash' }], outputs: [{ type: 'tuple', name: '', components: [{ type: 'bytes32', name: 'providerAgentId' }, { type: 'bytes32', name: 'buyerAgentId' }, { type: 'bytes32', name: 'receiptHash' }, { type: 'bytes32', name: 'requestHash' }, { type: 'bytes32', name: 'responseHash' }, { type: 'bytes32', name: 'signalHash' }, { type: 'uint128', name: 'amount' }, { type: 'uint64', name: 'timestamp' }, { type: 'uint8', name: 'rail' }, { type: 'bytes32', name: 'paymentRef' }, { type: 'bytes32', name: 'tradeTx' }, { type: 'address', name: 'provider' }, { type: 'bool', name: 'exists' }] }], stateMutability: 'view' },
  { type: 'function', name: 'isAnchored', inputs: [{ type: 'bytes32', name: 'receiptHash' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'getReceiptsByAgent', inputs: [{ type: 'bytes32', name: 'agentId' }], outputs: [{ type: 'bytes32[]' }], stateMutability: 'view' },
  { type: 'function', name: 'domainSeparator', inputs: [], outputs: [{ type: 'bytes32' }], stateMutability: 'view' },
  { type: 'event', name: 'ReceiptAnchored', inputs: [{ type: 'bytes32', indexed: true, name: 'receiptHash' }, { type: 'bytes32', indexed: true, name: 'providerAgentId' }, { type: 'bytes32', indexed: true, name: 'buyerAgentId' }, { type: 'uint128', name: 'amount' }, { type: 'uint8', name: 'rail' }] },
] as const;

export const MARKET_MIRROR_REGISTRY_ABI = [
  { type: 'function', name: 'registerMirror', inputs: [{ type: 'string', name: 'slug' }, { type: 'string', name: 'asset' }, { type: 'uint256', name: 'igniaMarketId' }, { type: 'uint64', name: 'deadline' }], outputs: [{ type: 'bytes32' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'markResolved', inputs: [{ type: 'bytes32', name: 'slugHash' }, { type: 'uint8', name: 'outcome' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getMirror', inputs: [{ type: 'bytes32', name: 'slugHash' }], outputs: [{ type: 'tuple', name: '', components: [{ type: 'bytes32', name: 'slugHash' }, { type: 'string', name: 'slug' }, { type: 'string', name: 'asset' }, { type: 'uint256', name: 'igniaMarketId' }, { type: 'uint64', name: 'createdAt' }, { type: 'uint64', name: 'deadline' }, { type: 'bool', name: 'resolved' }, { type: 'uint8', name: 'outcome' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getMirrorBySlug', inputs: [{ type: 'string', name: 'slug' }], outputs: [{ type: 'tuple', name: '', components: [{ type: 'bytes32', name: 'slugHash' }, { type: 'string', name: 'slug' }, { type: 'string', name: 'asset' }, { type: 'uint256', name: 'igniaMarketId' }, { type: 'uint64', name: 'createdAt' }, { type: 'uint64', name: 'deadline' }, { type: 'bool', name: 'resolved' }, { type: 'uint8', name: 'outcome' }] }], stateMutability: 'view' },
  { type: 'function', name: 'mirrorExists', inputs: [{ type: 'bytes32', name: 'slugHash' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'getAllSlugs', inputs: [], outputs: [{ type: 'bytes32[]' }], stateMutability: 'view' },
  { type: 'function', name: 'totalMirrors', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'authorizeMirror', inputs: [{ type: 'address', name: 'mirror' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'revokeMirror', inputs: [{ type: 'address', name: 'mirror' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'event', name: 'MirrorRegistered', inputs: [{ type: 'bytes32', indexed: true, name: 'slugHash' }, { type: 'string', name: 'slug' }, { type: 'string', name: 'asset' }, { type: 'uint256', indexed: true, name: 'igniaMarketId' }, { type: 'uint64', name: 'deadline' }] },
  { type: 'event', name: 'MirrorResolved', inputs: [{ type: 'bytes32', indexed: true, name: 'slugHash' }, { type: 'uint8', name: 'outcome' }] },
] as const;
