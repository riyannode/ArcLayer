# Internal x402 Library

`apps/console/src/lib/x402` is the console server-side x402 facilitator for Arc Testnet. It supports **x402 V2 exact payments via Circle Gateway only**:

- Circle Gateway batched EIP-3009 (`PAYMENT-SIGNATURE`) via `@circle-fin/x402-batching`.

> **Removed:** Arc Native EIP-3009 (`X-PAYMENT`) rail has been removed. The `X-PAYMENT` header and Arc Native settle/verify flows are no longer active. See [Migration](#migration) for historical context.

Import only from the barrel:

```ts
import { withX402 } from '@/lib/x402';
```

## Responsibilities

- Issue `402 Payment Required` responses with exact requirements on Arc Testnet.
- Parse and verify `PAYMENT-SIGNATURE` (Circle Gateway).
- Verify payment authenticity before any protected handler work is accepted.
- Run protected handler work before settlement by design to avoid charging failed work.
- Settle verified successful work, then atomically consume/replay-guard, then return `PAYMENT-RESPONSE`.
- Cache protected route responses for idempotent paid replays.

## Active flow

1. No payment headers: return `402` + `PAYMENT-REQUIRED`.
2. Payment present via `PAYMENT-SIGNATURE` (Circle Gateway).
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
| `headers.ts` | Encodes/decodes `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`. |
| `parser.ts` | Normalizes resources, validates payloads, derives `paymentIdentifier`. |
| `constants.ts` | x402 header names, Arc Testnet config, USDC address, Gateway constants. |
| `types.ts` | Shared x402 exact-only TypeScript types. |
| `exact/verify-exact.ts` | ~~EIP-3009 signature verification for Arc Native~~ (deprecated, no longer called). |
| `exact/settle-exact.ts` | ~~Relayer settlement for Arc Native~~ (deprecated, no longer called). |
| `gateway/batch-client.ts` | Lazy singleton wrapping `BatchFacilitatorClient`. |
| `gateway/payment-store.ts` | Supabase Gateway settlement/consume ledger helpers. |
| `middleware.ts` | Route middleware wiring for Gateway exact rail. |

Supabase service-role access is required for server-side persistence implementations. Browser code must not import this library.

## A2A Payments

Agent-to-agent payments use `agentId` + registered payer wallet. The legacy `X-PAYMENT` header approach is unsupported.

## Migration

- **Arc Native removed:** The `X-PAYMENT` header and associated `exact/verify-exact.ts` / `exact/settle-exact.ts` flows are deprecated and no longer active. These files remain in the tree for historical reference only.
- **X-PAYMENT deprecated:** All payment flows now use `PAYMENT-SIGNATURE` via Circle Gateway. Clients sending `X-PAYMENT` will receive a `402` with updated requirements.
