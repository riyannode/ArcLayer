# ArcLayer Roadmap

Protocol layer for agentic economy.

## v1.0 (current submission)

- [x] AgentRegistry + JobEscrow + WorkProof + ReputationOracle (deployed)
- [x] A2A marketplace contracts (A2AAgentRegistry, A2AReputationRegistry, A2AReceiptRegistry, MarketMirrorRegistry, Ignia)
- [x] AgentRegistryV2 with modular wallet support
- [x] Circle x402 payment integration (Gateway + Arc-native EIP-3009)
- [x] `/api/a2a/agents` with chunked getLogs for freetier RPC compatibility
- [x] `/api/a2a/status` aggregated protocol metrics
- [x] `/api/x402/verify` and `/api/x402/settle` endpoints
- [x] Agent execution via `/api/agents/[id]/run` with payment gating
- [x] SDK with typed contract addresses and ABI exports
- [x] Indexer with block-range chunking and event ingestion
- [x] Console UI: register, browse, execute agents
- [x] 77 unit tests + 25 Foundry contract tests

## v1.1 (post-hackathon)

### Contract improvements

- [ ] JobEscrow: add `cancelJob()` for stuck/expired jobs (currently no cancel path)
- [ ] JobEscrow: add deadline/expiry enforcement on-chain
- [ ] MarketMirrorRegistry: add access control for `mirrorAgent()` (currently permissionless)
- [ ] ReputationOracle: weighted scoring with decay

### Infrastructure

- [ ] Rate limiting: migrate from in-process Map to Upstash Redis / Vercel KV for multi-instance support
- [ ] Webhook notifications for job completion events
- [ ] WebSocket subscriptions for real-time agent status

### x402 / payments

- [ ] Full Gateway settlement verification in production mode
- [ ] Multi-token support (beyond USDC)
- [ ] Payment receipt on-chain anchoring via A2AReceiptRegistry
- [ ] Subscription/recurring payment model for long-running agents

### SDK / developer experience

- [ ] TypeScript SDK: add helper functions for A2A contract interactions
- [ ] CLI tool for agent registration and job management
- [ ] OpenAPI spec generation from route handlers
- [ ] Agent card metadata standard (JSON-LD / schema.org compatible)

### Marketplace

- [ ] Agent discovery with filtering, search, and reputation sorting
- [ ] Agent composition: chain multiple agents in a pipeline
- [ ] Dispute resolution mechanism via ReputationOracle
- [ ] Cross-chain agent registry bridging

## v2.0 (future)

- [ ] Mainnet deployment
- [ ] Decentralized agent execution (not reliant on single facilitator)
- [ ] ZK proof of agent work (privacy-preserving WorkProof)
- [ ] DAO governance for protocol parameters
- [ ] Agent staking and slashing for quality guarantees
