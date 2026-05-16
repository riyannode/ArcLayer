# Internal x402 Library

`apps/console/src/lib/x402` is the console server-side x402 facilitator for Arc Testnet. It implements **x402 V2 dual-mode** — Arc Native Payment (self-hosted EIP-3009 relayer) and Circle Gateway Payment (BatchFacilitatorClient) — plus the legacy V1 Arc escrow scheme.

Import only from the barrel:

```ts
import { createX402Facilitator, buildRequirement } from '@/lib/x402';
```

## Responsibilities

- Issue `402 Payment Required` responses with three options on Arc Testnet:
  - V2 `exact` (EIP-3009) — Arc Native Payment, settled via self-hosted relayer
  - V2 `exact` with `extra.name = "GatewayWalletBatched"` — Circle Gateway Payment
  - V1 `arc-escrow` — legacy on-chain JobEscrow flow
- Parse and verify `X-PAYMENT` (V1 / Arc Native) and `PAYMENT-SIGNATURE` (Gateway) headers.
- Route verify/settle by scheme via `isBatchPayment()` from `@circle-fin/x402-batching/server`.
- Settle Arc Native through a relayer-signed `transferWithAuthorization` on USDC.
- Settle Circle Gateway through a keyless `BatchFacilitatorClient`.
- Replay-protect both modes (on-chain nonce for Arc Native; Supabase paymentId ledger for Gateway).
- Cache protected route responses for idempotent paid replays.

## Layout

| File | Purpose |
| --- | --- |
| `index.ts` | Barrel exports for routes and tests. |
| `facilitator.ts` | Orchestrates V1 escrow flow (issue, verify, settle, consume, cache). |
| `requirements.ts` | Builds Arc Testnet payment requirements. |
| `headers.ts` | Encodes/decodes `PAYMENT-REQUIRED`, `X-PAYMENT`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`. |
| `parser.ts` | Normalizes resources, validates payloads, derives `paymentIdentifier`. |
| `constants.ts` | x402 header names, Arc Testnet config, USDC address, Gateway constants. |
| `types.ts` | Shared x402 TypeScript types (V1 + V2 + receipt union). |
| `store.ts` | Persistence interface. |
| `store.supabase.ts` | Supabase implementation of the persistence interface. |
| `verify-arc-escrow.ts` | V1: verify on-chain JobFunded receipt. |
| `exact/verify-exact.ts` | V2: full EIP-3009 signature ladder for Arc Native. |
| `exact/settle-exact.ts` | V2: relayer settlement for Arc Native (with optional Gateway REST fallback). |
| `gateway/batch-client.ts` | Lazy singleton wrapping `BatchFacilitatorClient`. |
| `gateway/dual-mode.ts` | Discriminated `X402PaymentReceipt` union (`provider: 'arc-native' \| 'circle-gateway'`). |
| `gateway/store.ts` | Supabase `x402_gateway_payments` ledger with atomic consume. |

## Routing inside `/api/x402/{verify,settle}`

```ts
import { isBatchPayment } from '@circle-fin/x402-batching/server';
import { getGatewayBatchClient } from '@/lib/x402/gateway/batch-client';

if (isBatchPayment(paymentRequirements)) {
  // Circle Gateway Payment
  return getGatewayBatchClient().verify(/* … */);
} else if (paymentRequirements.scheme === 'exact') {
  // Arc Native Payment
  return verifyExactPayment(/* … */);
} else {
  // Legacy V1 arc-escrow
  return facilitator.verifyPayment(/* … */);
}
```

## Protecting a route (V1 example)

```ts
import { NextResponse } from 'next/server';
import { createX402Facilitator } from '@/lib/x402';

const x402 = createX402Facilitator();

export async function POST(request: Request) {
  const resource = new URL(request.url).pathname;
  const payment = x402.parsePaymentFromRequest(request);

  if (!payment) {
    return x402.paymentRequired({
      resource,
      resourceMethod: 'POST',
      amountRequired: '0.10',
      description: 'Run protected agent',
    });
  }

  const verified = await x402.verifyPayment({ payment, resource });
  if (!verified.ok) return x402.paymentRejected(verified);

  const settled = await x402.settlePayment({ paymentId: verified.payment.paymentId });
  if (!settled.ok) return x402.paymentRejected(settled);

  const consumed = await x402.consumePayment({
    paymentId: verified.payment.paymentId,
    txHash: verified.payment.txHash,
    requirementId: verified.requirement.requirementId,
    resource,
    resourceMethod: 'POST',
  });

  if (!consumed.ok) {
    if (consumed.cachedResponse) return x402.toResponse(consumed.cachedResponse);
    return NextResponse.json({ ok: false, error: consumed }, { status: 409 });
  }

  return x402.cacheAndReturn({
    payment: verified.payment,
    consumptionId: consumed.consumptionId!,
    resource,
    statusCode: 200,
    responseBody: { ok: true, result: 'paid work complete' },
  });
}
```

For protected routes accepting both Arc Native and Gateway, see `apps/console/src/app/api/x402-demo/protected/route.ts`.

## EIP-712 signing domains

Both V2 modes use the `TransferWithAuthorization` typed-data structure but with different domains:

| Mode | name | version | verifyingContract |
| --- | --- | --- | --- |
| Arc Native (EIP-3009) | live `name()` from USDC | live `version()` from USDC | USDC `0x3600…0000` |
| Circle Gateway | `GatewayWalletBatched` | `1` | GatewayWallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |

USDC `name()` and `version()` are read live, never hardcoded. The Gateway domain is sourced from `extra` on the matching `/supported` option.

## Configuration

| Variable | Use |
| --- | --- |
| `ARC_RPC_URL` | Arc Testnet RPC URL used by on-chain verification. |
| `X402_DEFAULT_PAY_TO` | Optional default recipient. Must be a `0x` EVM address. |
| `X402_RELAYER_PRIVATE_KEY` | Private key for the Arc Native relayer that submits `transferWithAuthorization`. |
| `X402_SETTLE_MODE` | `self-hosted` (default) or `gateway-rest`. |
| `X402_REQUIREMENT_TTL_SECONDS` | Optional V1 requirement expiration override. |
| `X402_RESPONSE_CACHE_TTL_SECONDS` | Optional paid response cache TTL override. |
| `CIRCLE_API_KEY` | Optional. Only used by the Gateway REST fallback in `settle-exact.ts`. The keyless facilitator path (`BatchFacilitatorClient()`) does not require it. |

Supabase service-role access is required for the persistence implementation. Browser code must not import this library.

## Migration notes

- Use `@/lib/x402` instead of importing individual files.
- Prefer `createX402Facilitator()` in V1 escrow API routes.
- For V2 routes, import the verify/settle helpers directly: `verify-exact`, `settle-exact`, and the Gateway batch client.
- Keep resource strings canonical with the request pathname or `canonicalResource()`.
- Treat `consumePayment()` (V1) and the Gateway `paymentId` ledger (V2) as the replay boundary. Return `toResponse(cachedResponse)` when available.
