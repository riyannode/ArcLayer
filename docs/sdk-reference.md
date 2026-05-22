# SDK Reference (Arc/Circle current)

## Constants
- `CONTRACTS.ERC8004_IDENTITY_REGISTRY`
- `CONTRACTS.ERC8004_REPUTATION_REGISTRY`
- `CONTRACTS.ERC8004_VALIDATION_REGISTRY`
- `CONTRACTS.ERC8183_AGENTIC_COMMERCE`
- `ARC_TOKENS.USDC`
- `ARC_TOKENS.EURC`

## Writes
- `buildRegisterAgentConfig(metadataURI)`
- `buildCreateJobConfig(provider,evaluator,expiredAt,description,hook)`
- `buildSetBudgetConfig(jobId,amount,"0x")`
- `buildFundJobConfig(jobId,"0x")`
- `buildSubmitDeliverableConfig(jobId,deliverableHash,"0x")`
- `buildCompleteJobConfig(jobId,reasonHash,"0x")`

## Identity id derivation
Agent id is the minted ERC-8004 token id from Transfer mint event (`from=0x0`).
