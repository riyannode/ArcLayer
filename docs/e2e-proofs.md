# E2E Proofs (Current Arc/Circle)

Current lifecycle:
1. ERC-8004 `register(metadataURI)`.
2. Parse mint `Transfer(from=0x0,to=owner,tokenId)` for agent id.
3. ERC-8183 `createJob(provider,evaluator,expiredAt,description,hook)`.
4. `setBudget(jobId,amount,"0x")`.
5. USDC `approve(AgenticCommerce,amount)`.
6. `fund(jobId,"0x")`.
7. `submit(jobId,deliverableHash,"0x")`.
8. `complete(jobId,reasonHash,"0x")`.

Legacy protocol proof notes are archive-only and must live under `docs/archive/`.
