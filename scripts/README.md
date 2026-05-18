# Scripts

Live verification scripts on Arc Testnet.

## `job-cycle-live.sh`

Runs a full job cycle with 3 burner wallets:

```text
createJob → setBudget → approve USDC → fund
         → submitDeliverable → evaluate → settle
         → mints WorkProof to worker
```

Roles: client, worker, evaluator. Each run mints a soulbound `WorkProof` ERC721 NFT to the worker.

```bash
bash scripts/job-cycle-live.sh
```

Requires:
- `cast` from Foundry
- Private keys at `/tmp/arclayer_{client,worker,evaluator}.pk` (0600)
- Each wallet funded with native gas + USDC (5+ USDC for client)

## `probe-arc-usdc-capability.mjs`

Probes Arc Testnet USDC for x402 capability (EIP-712 domain, `transferWithAuthorization`, decimals).

```bash
node scripts/probe-arc-usdc-capability.mjs
```

Output is summarized in [`../docs/x402/arc-capability-report.md`](../docs/x402/arc-capability-report.md).
