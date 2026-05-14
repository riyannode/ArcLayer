# Internal x402 Library

`apps/console/src/lib/x402` contains the console server-side x402 facilitator for Arc Testnet escrow payments. Import from the barrel file only:

```ts
import { createX402Facilitator, buildRequirement } from '@/lib/x402';
```

## Responsibilities

- Issue `402 Payment Required` responses with Arc escrow requirements.
- Parse and validate `X-PAYMENT` request headers.
- Verify Arc `JobFunded` events against the issued requirement.
- Settle verified payments and atomically consume each payment once per resource.
- Cache protected route responses for idempotent paid replays.

## Main modules

| File | Purpose |
| --- | --- |
| `index.ts` | Stable exports for routes and tests. |
| `facilitator.ts` | Orchestrates requirement issue, verify, settle, consume, cache, and response helpers. |
| `requirements.ts` | Builds and persists Arc Testnet payment requirements. |
| `headers.ts` | Encodes and decodes `PAYMENT-REQUIRED`, `X-PAYMENT`, and `PAYMENT-RESPONSE` payloads. |
| `parser.ts` | Normalizes resources and validates incoming payment payloads. |
| `verify-arc-escrow.ts` | Checks on-chain Arc escrow payment evidence. |
| `store.ts` | Defines the persistence interface. |
| `store.supabase.ts` | Implements the persistence interface with Supabase. |
| `constants.ts` | Holds x402 header names, Arc Testnet values, addresses, and defaults. |
| `types.ts` | Defines shared x402 TypeScript types. |

## Protecting a route

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

  const body = { ok: true, result: 'paid work complete' };
  return x402.cacheAndReturn({
    payment: verified.payment,
    consumptionId: consumed.consumptionId!,
    resource,
    statusCode: 200,
    responseBody: body,
  });
}
```

## Configuration

| Variable | Use |
| --- | --- |
| `ARC_RPC_URL` | Arc Testnet RPC URL used by on-chain verification. |
| `X402_DEFAULT_PAY_TO` | Optional default recipient. Must be a `0x` EVM address. |
| `X402_REQUIREMENT_TTL_SECONDS` | Optional requirement expiration override. |
| `X402_RESPONSE_CACHE_TTL_SECONDS` | Optional paid response cache TTL override. |

Supabase service-role access is required for the store implementation. Browser code must not import this library.

## Migration notes

- Use `@/lib/x402` instead of importing individual files.
- Prefer `createX402Facilitator()` in API routes so route code uses one orchestration path.
- Keep resource strings canonical with the request pathname or `canonicalResource()`.
- Treat `consumePayment()` as the replay boundary. Return `toResponse(cachedResponse)` when available.
