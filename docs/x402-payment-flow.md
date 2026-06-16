---
title: x402 Payment Flow
description: Paid API access via Circle Gateway (Gateway-only mode).
---

# x402 Payment Flow
ArcLayer uses the x402 protocol for agent-to-agent and agent-to-service payments. **Circle Gateway is the only active payment rail.**

## Live Endpoint

The public x402 protected resource is:

```
https://arclayers.xyz/api/x402/protected-resource
```

Verify the endpoint returns a valid 402 challenge:

```bash
curl -i https://arclayers.xyz/api/x402/protected-resource
```

**Expected response:**
- HTTP 402
- Header: `payment-required: <base64>`
- Header: `x-402-version: 2`
- Body: `{ "error": "payment_required", "accepts": [...] }`

If you get 404, the path is wrong. If you get HTML, the domain is wrong. If you get 200, the route is not x402-gated.

## Host Allowlist vs Endpoint URL

The runner `allowedX402Hosts` controls **which domains** the runner may pay. It is not the endpoint path.

- `allowedX402Hosts` = domain only: `arclayers.xyz`
- x402 resource URL = full path: `https://arclayers.xyz/api/x402/protected-resource`

**Correct config:**
```json
{
  "allowedX402Hosts": ["arclayers.xyz"]
}
```

If you need to test against `api.arclayers.xyz` as well, add both:
```json
{
  "allowedX402Hosts": ["api.arclayers.xyz", "arclayers.xyz"]
}
```

> **Note:** As of June 2026, `api.arclayers.xyz` does not route to the console app. Use `arclayers.xyz` as the default.

## Runner x402.pay Schema

The runner MCP tool `x402.pay` expects:

```json
{
  "url": "https://arclayers.xyz/api/x402/protected-resource",
  "maxAmountUsdc": "0.000001",
  "reason": "live x402 test",
  "idempotencyKey": "x402-live-test-1234567890"
}
```

**Required fields:**
- `url` — full x402 resource URL
- `maxAmountUsdc` — maximum payment amount in USDC (string, e.g. `"0.01"`)
- `reason` — human-readable reason for the payment

**Optional fields:**
- `idempotencyKey` — prevents double-spend on retry
- `method` — HTTP method (default: `GET`)
- `body` — request body for POST requests

Do not use `amount` — the field is `maxAmountUsdc`.

## Implementation

> **Arc Native removed (June 2026):** The Arc Native EIP-3009 payment rail has been removed. Arc Native is no longer active for x402 payments. Historical migration references are preserved below for reference only.

- **Circle Gateway** *(active)*: The only active x402 payment rail. Handles cross-chain USDC flows via batched EIP-3009.
- **EIP-3009**: Used under the hood by Circle Gateway for gasless/frictionless transfer authorizations.
- **Arc Native** *(removed)*: Previously used ERC-8183 AgenticCommerce for on-chain escrow. No longer supported.

## Challenge/Response
1. Request: `GET /api/resource`
2. No payment: `402 Payment Required` with headers `X-402-Version` and `PAYMENT-REQUIRED`.
3. Default retry header: `PAYMENT-SIGNATURE: <payment-payload>`.
4. `X-PAYMENT` **(deprecated)**: Previously accepted as a legacy Arc Native compatibility header. Use `PAYMENT-SIGNATURE` exclusively.
5. Success responses include `PAYMENT-RESPONSE`.
