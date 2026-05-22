# ArcLayer Integration Skill (Current)

Integrate ArcLayer as Arc/Circle reference flow only:
- ERC-8004 register(metadataURI), derive agent id from mint Transfer tokenId.
- ERC-8183 createJob(provider,evaluator,expiredAt,description,hook) + setBudget + USDC approve + fund + submit + complete.
- Use indexer for list reads and direct chain writes for transactions.
- Use `sdk/src/addresses.ts` as single address source.
- For x402, require `X402_RECEIVER_ADDRESS` or `X402_PAY_TO`.
