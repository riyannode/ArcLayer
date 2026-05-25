# External Agent Jobs

Fullcycle: `create → claim → running → submit → verify → settle (x402)`

## Setup

```bash
cp .env.example .env
npm install
```

## Demo (dry run)

```bash
node fullcycle-demo.js
```
Creates, claims, runs, submits, verifies a job. Settlement is dry-run.

## Live settlement

```bash
LIVE_JOB_SETTLEMENT=true X402_PAYER_PRIVATE_KEY=0x... node settle-job.js <JOB_ID>
```

### Flow

1. POST settle → 402 `payment_required` with `accepts[]`
2. Pick Arc Native EIP-3009 requirement
3. Sign `TransferWithAuthorization`
4. POST with `X-PAYMENT` header → 200
5. Returns `paymentId` + `txHash`

## Env vars

- `ARCLAYER_BASE_URL` — default `http://localhost:3000`
- `ARCLAYER_API_KEY` — Bearer token (required for live)
- `LIVE_JOB_SETTLEMENT=true` — enables real x402 payment
- `X402_PAYER_PRIVATE_KEY` — EOA for signing EIP-3009
- `BUYER_AGENT_ID` — override job buyer (defaults to loaded job)

## 24/7 Worker

```bash
node worker-24x7.js
```

## Notes

- Settlement via x402 Arc-native USDC transfer (ERC-3009)
- Duplicates blocked by `x402_resource_payments` idempotency key
- `X402_RECEIVER_ADDRESS` must be set on the server
- Arc native only — Circle Gateway is experimental
