# ArcLayer Agents — Agent-to-Agent Commerce on Arc

> Two AI agents trading signals for USDC, settled instantly on Arc Testnet via x402.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        ARC TESTNET                               │
│                   (chain 5042002 · USDC)                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ settlement
                           │
┌──────────────┐    x402   │    ┌──────────────────────────────┐
│  Pythia · Σ  │◄──────────┼────│       Hermes · Δ             │
│  Signal      │  pay 0.01 │    │  Autonomous Trader           │
│  Oracle      │  USDC per │    │                              │
│              │  signal    │    │  1. Buy signal from Pythia   │
│  /signal/BTC │───────────►    │  2. Evaluate confidence      │
│  /signal/ETH │  return    │    │  3. Execute paper trade      │
│  /signal/SOL │  signal    │    │  4. Track P&L               │
└──────────────┘            │    └──────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │ ArcLayer    │
                    │ Facilitator │
                    │ (verify +   │
                    │  settle)    │
                    └─────────────┘
```

## Flow

1. **Hermes** requests `GET /signal/BTC` from Pythia
2. **Pythia** returns `HTTP 402` + payment requirements (0.01 USDC)
3. **Hermes** signs EIP-3009 `transferWithAuthorization` (gasless for buyer)
4. **Hermes** retries with `X-PAYMENT` header
5. **Pythia** forwards to ArcLayer facilitator → verify → settle on-chain
6. **Pythia** returns trading signal (BUY/SELL/HOLD + confidence + reasoning)
7. **Hermes** evaluates signal → executes paper trade if confidence > 60%
8. Loop repeats every 15s across BTC, ETH, SOL

**Total user action: zero.** Both agents operate autonomously.

## Quick Start

```bash
cd agents
npm install

# 1. Create agent wallet
node -e "import('viem/accounts').then(m => console.log(m.generatePrivateKey()))"

# 2. Fund wallet with testnet USDC
#    (use Arc Testnet faucet or transfer from existing wallet)

# 3. Configure
cp .env.example .env
# Edit .env — set HERMES_PRIVATE_KEY

# 4. Start Pythia (terminal 1)
npm run pythia

# 5. Start Hermes (terminal 2)
npm run hermes
```

## Agents

### Pythia · Σ (The Oracle)
- **Role:** Sells trading signals behind x402 paywall
- **Revenue model:** 0.01 USDC per signal
- **Logic:** MA crossover + RSI momentum + volatility filter
- **Endpoints:**
  - `GET /signal/:token` — x402 gated (BTC, ETH, SOL)
  - `GET /health` — agent status
  - `GET /stats` — revenue metrics

### Hermes · Δ (The Trader)
- **Role:** Autonomous buyer + paper trader
- **Spend:** 0.01 USDC per signal purchase
- **Logic:** Buy signals → filter by confidence → execute paper trades
- **Strategy:** Position sizing based on signal confidence (3-15% allocation)

## Settlement

All payments settle on **Arc Testnet** (chain 5042002):
- Asset: USDC (`0x3600000000000000000000000000000000000000`)
- Method: EIP-3009 `transferWithAuthorization`
- Finality: sub-second
- Fee: ~$0.01
- Facilitator: ArcLayer (verify + on-chain execution)

## Circle Tools Used

| Tool | Usage |
|------|-------|
| USDC | Settlement rail for agent payments |
| Arc Testnet | L1 with sub-second finality |
| x402 / Nanopayments | Payment protocol (HTTP 402 flow) |
| Circle Gateway | Alternative settlement path (dual-mode) |

## For Hackathon Judges

This demonstrates:
- ✅ AI agents autonomously transacting with each other
- ✅ Real USDC settlement on Arc (verifiable on-chain)
- ✅ x402 protocol for pay-per-inference
- ✅ Zero human intervention after startup
- ✅ Gasless for buyer (relayer pays gas)
- ✅ Replay protection (nonce tracking)
- ✅ Sub-second settlement finality
