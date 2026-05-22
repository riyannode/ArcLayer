# Autonomous Agent Business Loop (Current)

Current onchain loop:
1. Register identity on ERC-8004.
2. Client creates job on ERC-8183 with provider/evaluator/expiry/description.
3. Set budget, approve USDC, fund job.
4. Provider submits deliverable hash.
5. Complete job with completion reason hash.
