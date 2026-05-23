# Internal x402 Library

`apps/console/src/lib/x402` is the console server-side x402 facilitator for Arc Testnet. It supports **x402 V2 exact rails only**:

- Arc Native EIP-3009 (`X-PAYMENT`) settled by ArcLayer self-hosted relayer.
- Circle Gateway batched EIP-3009 (`PAYMENT-SIGNATURE`) via `@circle-fin/x402-batching`.

Import only from the barrel:

```ts
import { withX402, buildRequirement } from '@/lib/x402';
```

## Responsibilities

- Issue `402 Payment Required` responses with exact requirements on Arc Testnet.
- Parse and verify `X-PAYMENT` (Arc Native) and `PAYMENT-SIGNATURE` (Circle Gateway).
- Verify payment authenticity before any protected handler work is accepted.
- Run protected handler work before settlement by design to avoid charging failed work.
- Settle verified successful work, then atomically consume/replay-guard, then return `PAYMENT-RESPONSE`.
- Cache protected route responses for idempotent paid replays.

## Active flow

1. No payment headers: return `402` + `PAYMENT-REQUIRED`.
2. Payment present:
   - Arc Native uses `X-PAYMENT`.
   - Circle Gateway uses `PAYMENT-SIGNATURE`.
3. Verify payment.
4. Execute protected handler success gate.
5. Settle verified successful payment.
6. Consume payment (replay protection).
7. Return handler response with `PAYMENT-RESPONSE`.

## Layout

| File | Purpose |
| --- | --- |
| `index.ts` | Barrel exports for routes and tests. |
| `requirements.ts` | Builds Arc Testnet payment requirements. |
| `headers.ts` | Encodes/decodes `PAYMENT-REQUIRED`, `X-PAYMENT`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`. |
| `parser.ts` | Normalizes resources, validates payloads, derives `paymentIdentifier`. |
| `constants.ts` | x402 header names, Arc Testnet config, USDC address, Gateway constants. |
| `types.ts` | Shared x402 exact-only TypeScript types. |
| `exact/verify-exact.ts` | EIP-3009 signature verification for Arc Native. |
| `exact/settle-exact.ts` | Relayer settlement for Arc Native. |
| `gateway/batch-client.ts` | Lazy singleton wrapping `BatchFacilitatorClient`. |
| `gateway/payment-store.ts` | Supabase Gateway settlement/consume ledger helpers. |
| `middleware.ts` | Route middleware wiring for dual exact rails. |

Supabase service-role access is required for server-side persistence implementations. Browser code must not import this library.
