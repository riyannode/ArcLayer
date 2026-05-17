# ArcLayer Operations Scripts

Live on-chain scripts for end-to-end protocol verification.

## Files

### `job-cycle-live.sh`

Executes a complete job cycle on Arc testnet using 3 burner wallets:

```
createJob → setBudget → approve USDC → fund → submitDeliverable → evaluate → settle
                                                                              ↓
                                                            mints WorkProof NFT
```

**Roles:**
| Role | Address | Action |
|---|---|---|
| Client | `0x9dc3...B074` | createJob, setBudget, fund, settle |
| Worker | `0xd515...98b5` | submitDeliverable, receives payout |
| Evaluator | `0xda1d...FA1D` | evaluate (approve work) |

**Result:** Each run mints a soulbound `WorkProof` ERC721 NFT to the worker, indexed by `proofTokenByJobId(jobId)`.

**Verified live:** Job 27 → tokenId 6, payout 4.975 USDC (5 USDC budget − 0.5% platform fee), tx `0xf925cf92...95123f`.

**Run:**
```bash
bash scripts/job-cycle-live.sh
```

Requires:
- `/root/.foundry/bin/cast`
- Private keys at `/tmp/arclayer_{client,worker,evaluator}.pk`
- Each wallet funded with native ETH (gas) + USDC (5+ USDC for client)

---

## Hermes Trading Loop — Activation

Hermes is the autonomous trader agent that pays Pythia for signals via x402, then trades on Ignia prediction markets.

**Status check:**
```bash
curl -s https://arclayers.xyz/api/a2a/status | jq '.agents.hermes'
```

If `callsServed == 0`, the loop is not running.

**To activate** (on the host running Pythia):

```bash
cd /root/ArcLayer
# Verify env
grep -E 'HERMES_PRIVATE_KEY|PYTHIA_URL|HERMES_INTERVAL_MS' agents/.env

# Run with PM2
pm2 start agents/hermes/agent.ts --name hermes-trader --interpreter tsx
pm2 logs hermes-trader --lines 30
```

**Env knobs** (`agents/.env`):
- `HERMES_INTERVAL_MS=35000` — 35s between signal purchases
- `HERMES_MAX_ITERATIONS=0` — 0 = infinite loop
- `ENABLE_IGNIA_EXECUTION=true` — set false for paper-trading only
- `MIN_IGNIA_CONFIDENCE=60` — only trade if signal confidence ≥ 60%

**Per-trade flow:**
1. GET `${PYTHIA_URL}/signal/${token}` → 402 Payment Required
2. Build EIP-3009 USDC payment (0.01 USDC per signal)
3. Submit via x402 facilitator → receive signal JSON
4. If `confidence ≥ MIN_IGNIA_CONFIDENCE` and `signal != HOLD`:
   → buy YES (BUY) or NO (SELL) shares on the latest Ignia market
5. Wait `HERMES_INTERVAL_MS` and repeat

So yes — **trading IS per-signal-per-loop-iteration**. Each iteration:
- 1 paid signal call (x402 USDC settlement)
- Optional 1 Ignia trade (only if confidence threshold met)

If Hermes shows 0 calls but is funded, the process is simply not running. It's not a code or wiring bug.
