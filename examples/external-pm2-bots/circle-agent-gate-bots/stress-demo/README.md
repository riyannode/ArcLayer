# Circle x402 High-Frequency Stress Demo

Stress test harness for Circle Gateway x402 agent commerce — runs 9 paid access cycles per minute to validate throughput, payment reliability, and receipt integrity.

**This is a demo/stress tool, not production config.** Production bots should use the parent directory's default 1x/5min pace.

## Requirements

- `HI_FREQ_ENABLED=true` — must be explicitly enabled
- `STRESS_MODE=true` — enables synthetic sourcePayloadHash for stress speed
- `PAY_PER_MINUTE=9` — target payment frequency

## What "9 paid access cycles/minute" Means

Each cycle:
1. Read upstream event
2. Process with LLM (cached 5 min)
3. Post bridge event (purchase intent)
4. Pay seller via Circle Gateway x402
5. Post output event + receipt

This is **9 paid access cycles per minute**, not 9 onchain transactions per minute. Circle Gateway batches settlements — actual onchain tx count depends on Circle's batching schedule.

## Files

| File | Description |
|------|-------------|
| `run-buyer-hi-freq.js` | High-frequency buyer (analyzer/evaluator/executor) |
| `run-oracle-hi-freq.js` | High-frequency oracle publisher |
| `run-stress.sh` | Launcher script with HI_FREQ_ENABLED guard |
| `stress-x402.js` | x402 payment stress test (p50/p95/p99/TPS) |
| `check-payment.js` | Check payment status |
| `.env.hi-freq.example` | Environment template for hi-freq mode |
| `ecosystem.*.config.js` | PM2 configs for hi-freq processes |

## Usage

```bash
# Copy and configure
cp .env.hi-freq.example .env.hi-freq
# Edit .env.hi-freq with your credentials

# Run stress demo
HI_FREQ_ENABLED=true STRESS_MODE=true bash stress-demo/run-stress.sh

# Or run individual bots
HI_FREQ_ENABLED=true node stress-demo/run-buyer-hi-freq.js analyzer
HI_FREQ_ENABLED=true node stress-demo/run-oracle-hi-freq.js
```

## PM2 (Stress Mode)

```bash
pm2 start stress-demo/ecosystem.stress.config.js
pm2 logs oracle-hi-freq
```

## Key Differences from Production

| | Production | Stress Demo |
|---|-----------|-------------|
| Pace | 1x / 5 min | 9x / min |
| sourcePayloadHash | Real upstream hash | Synthetic (STRESS_MODE) |
| LLM cache | 5 min | 5 min (shared) |
| HI_FREQ_ENABLED | false | **true** (required) |
