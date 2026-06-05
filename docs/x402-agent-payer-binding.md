# x402 Circle Gateway Per-Agent Payer — Manual Verification Guide

## Overview

External agents pay x402 protected resources via Circle Gateway using their **own EOA payer wallet**.
ArcLayer enforces `actual_payer == registered_payer`. No shared platform payer fallback.

---

## Prerequisites

- [ ] ERC-8004 agent registered (e.g. agentId `36191`)
- [ ] API key created for the agent
- [ ] Separate EOA payer wallet generated (NOT the controller wallet)
- [ ] Payer wallet funded with USDC on Arc Testnet (via https://faucet.circle.com)
- [ ] Circle Gateway enabled: `X402_GATEWAY_ENABLED=true` in Vercel env

---

## Step 1: Register x402 Payer

```bash
# POST /api/agents/:id/x402-payer
# Requires wallet session (browser login as agent controller)

curl -X POST https://arclayers.xyz/api/agents/36191/x402-payer \
  -H "Content-Type: application/json" \
  -H "Cookie: arclayer-wallet-session=<session-token>" \
  -d '{
    "payerAddress": "0xYourPayerEOA",
    "rail": "circle-gateway"
  }'
```

**Expected:**
```json
{
  "ok": true,
  "agentId": "36191",
  "payer": {
    "id": "...",
    "payerAddress": "0xYourPayerEOA",
    "rail": "circle-gateway",
    "status": "active",
    "verifiedAt": "2026-..."
  }
}
```

## Step 2: Verify Payer Registration

```bash
# GET /api/agents/:id/x402-payer
curl https://arclayers.xyz/api/agents/36191/x402-payer \
  -H "Cookie: arclayer-wallet-session=<session-token>"
```

**Expected:** Returns list of payers, status `active`.

## Step 3: Fund Gateway Deposit

The payer EOA needs a Gateway deposit. Use Circle GatewayClient or faucet.

## Step 4: Start External PM2 Bot

```bash
# .env
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_AGENT_ID=36191
ARCLAYER_API_KEY=ak_xxx
ARCLAYER_RUNTIME_ID=pm2-provider-1
X402_RAIL=circle-gateway
X402_GATEWAY_CHAIN=arcTestnet
X402_GATEWAY_PAYER_PRIVATE_KEY=0xPayerPrivateKey
X402_GATEWAY_MAX_PRICE_RAW=10000
```

## Step 5: Call Circle Gateway Protected Resource

```javascript
const { payForGatewayResource } = require('./shared/x402-gateway-client');

const result = await payForGatewayResource({
  resource: '/api/x402/bridge-access',
  body: { sessionId: 'test-session', scope: 'external_trace', role: 'executor' },
});

console.log(result);
```

**Expected (success):**
```json
{
  "ok": true,
  "payer": "0xYourPayerEOA",
  "paymentId": "...",
  "transaction": "...",
  "agentId": "36191",
  "payerVerified": true,
  "mode": "circle-gateway"
}
```

## Step 6: Verify Ledger Entry

Check Supabase `agent_x402_payment_ledger` table:
```sql
SELECT * FROM agent_x402_payment_ledger
WHERE agent_id = '36191'
ORDER BY created_at DESC
LIMIT 5;
```

Expected: row with `status = 'settled'`, `payer_address = '0xYourPayerEOA'`.

---

## Negative Tests

### Test 1: No Registered Payer → Reject

Remove the payer registration, then try to pay:

```bash
DELETE /api/agents/36191/x402-payer?rail=circle-gateway
```

**Expected:** `403 agent_x402_payer_not_configured`

### Test 2: Wrong Payer Private Key → Mismatch

Set `X402_GATEWAY_PAYER_PRIVATE_KEY` to a different EOA (not the registered one).

**Expected:** `403 x402_payer_mismatch`

### Test 3: Revoked Payer → Reject

Revoke the payer, then try to pay.

**Expected:** `403 agent_x402_payer_not_configured`

### Test 4: Replay Payment → Reject

Send the same payment proof twice.

**Expected:** Second attempt returns `409 payment_replayed`

---

## Architecture Summary

```
External Bot (PM2)
  → GatewayClient.sign(proof) with own EOA private key
  → POST /api/x402/resource with PAYMENT-SIGNATURE header
  → ArcLayer middleware:
      1. facilitator.verify(proof) → valid + actualPayer
      2. resolveRequiredAgentX402Payer(agentId) → expectedPayer
      3. assertX402PayerMatches(actual, expected)
         - mismatch → 403 x402_payer_mismatch (DO NOT SETTLE)
         - match → continue
      4. claimGatewaySettlement() + facilitator.settle()
      5. recordGatewayPayment() with agentId, payerVerified=true
      6. recordAgentX402Ledger() (audit trail)
  → Response with PAYMENT-RESPONSE including agentId, payerVerified
```

**Key security rule:** If no registered payer → reject. If actual payer != registered payer → reject before settlement. Never store private keys in ArcLayer DB.

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/0022_x402_agent_payer_binding.sql` | New: payer table, ledger table, RPC safety, gateway extension |
| `apps/console/src/lib/x402/agent-payer.ts` | New: resolver + assertion helpers |
| `apps/console/src/lib/x402/agent-ledger.ts` | New: ledger recording |
| `apps/console/src/app/api/agents/[id]/x402-payer/route.ts` | New: GET/POST/DELETE payer API |
| `apps/console/src/lib/x402/middleware.ts` | Patch: agentPayerBinding option + payer check in handleGateway |
| `apps/console/src/lib/x402/gateway/payment-store.ts` | Patch: extend types + recordGatewayPayment with agent context |
| `examples/external-pm2-bots/market-agent-bridge/shared/x402-gateway-client.js` | New: Gateway bot client |
| `apps/console/src/lib/x402/agent-payer.test.ts` | New: resolver + assertion tests |

**Not modified:** ERC-8004, ERC-8183, contracts, existing native x402 client.
