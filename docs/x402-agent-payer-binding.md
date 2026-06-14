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

## Step 4: Start External Runtime

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

### Test 5: Invalid agentId → Reject

Call resolver with injection chars or >128 chars:

```ts
resolveRequiredAgentX402Payer('36191; DROP TABLE') // → invalid_agent_id
resolveRequiredAgentX402Payer('a'.repeat(129))      // → invalid_agent_id
```

**Expected:** `invalid_agent_id` error (400)

### Test 6: Circle Agent Account Ownership

Register payer for an agent whose controller is a Circle Agent Account (not EOA).
Login with the owner wallet that created the Agent Account.

**Expected:** Ownership check passes via `getActiveAgentAccountForOwner()` → `getLinkedErc8004AgentsForController()`.

### Test 7: Bound Route — Missing Payer Rejected Before Settlement

Call `/api/agents/:id/run` without registering a payer first.

**Expected:** `403 agent_x402_payer_not_configured` — middleware rejects before `claimGatewaySettlement()`.

### Test 8: Bound Route — Payer Mismatch Rejected Before Settlement

Register payer A, pay from payer B's EOA on `/api/agents/:id/run`.

**Expected:** `403 x402_payer_mismatch` — middleware rejects before settlement.

### Test 9: Bound Route — Correct Payer Accepted

Register payer A, pay from payer A's EOA on `/api/agents/:id/run`.

**Expected:** `200` success, `PAYMENT-RESPONSE` includes `agentId`, `expectedPayer`, `payerVerified: true`.

### Test 10: Ledger Records Agent Context

After successful payment, check ledger:

```sql
SELECT agent_id, expected_payer, payer_address, controller_address, status
FROM agent_x402_payment_ledger
WHERE agent_id = '36191'
ORDER BY created_at DESC LIMIT 1;
```

**Expected:** `agent_id`, `expected_payer`, `payer_address` all populated. `payer_address = expected_payer`.

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
| `apps/console/src/lib/x402/agent-payer.ts` | Resolver + assertion + `validateAgentId()` (two-step query, no `.or()`) |
| `apps/console/src/lib/x402/agent-ledger.ts` | New: ledger recording |
| `apps/console/src/app/api/agents/[id]/x402-payer/route.ts` | GET/POST/DELETE payer API with dual-controller ownership |
| `apps/console/src/app/api/agents/[id]/run/route.ts` | Bound route: `agentPayerBinding.required = true`, `allowedRails: ['circle-gateway-passkey']` |
| `apps/console/src/lib/x402/middleware.ts` | Patch: agentPayerBinding option + payer check in handleGateway |
| `apps/console/src/lib/x402/gateway/payment-store.ts` | Patch: extend types + recordGatewayPayment with agent context |
| `apps/console/src/lib/x402/agent-payer.test.ts` | 24 tests: validateAgentId, resolver, assertion, binding flow |
| `docs/x402-agent-payer-binding.md` | Manual verification guide (10 test scenarios) |

**Not modified:** ERC-8004, ERC-8183, contracts, existing native x402 client.

## Security Hardening (PR #457)

- **`.or()` injection removed**: Resolver uses two separate `.eq()` queries instead of `.or(`agent_id.eq.${userInput}`)`.
- **agentId validation**: `/^[a-zA-Z0-9_-]+$/`, max 128 chars. Rejects before any DB query.
- **Dual-controller ownership**: API route supports both EOA-controlled and Circle Agent Account-controlled agents.
- **Bound route**: `/api/agents/:id/run` requires registered payer, rejects mismatch before settlement.
- **No shared payer fallback**: Missing payer → 403. Mismatch → 403. Both reject before `claimGatewaySettlement()`.
