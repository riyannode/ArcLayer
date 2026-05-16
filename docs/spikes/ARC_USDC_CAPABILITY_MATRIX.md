# Arc USDC Capability Matrix

**Status:** PR 0 spike evidence  
**Date:** 2026-05-16  
**Network:** Arc Testnet  
**Chain ID:** `5042002`  
**Preferred RPC:** `https://rpc.drpc.testnet.arc.network`  
**USDC token:** `0x3600000000000000000000000000000000000000`

## Objective

Validate whether Arc Testnet USDC supports the authorization primitives required for standard x402 `exact` payments:

- EIP-3009 `transferWithAuthorization`
- EIP-2612 `permit`
- EIP-712 domain support
- Permit2 compatibility

This determines whether ArcLayer can support both:

1. `arc-escrow` — ArcLayer-native payment flow through `JobEscrow`
2. `exact` — standard x402-compatible payment flow using gasless client signatures and a relayer

## Capability Matrix

| Feature | Status | Evidence |
|---|---:|---|
| ERC-20 baseline | ✅ Supported | `name()`, `symbol()`, `decimals()`, `totalSupply()` returned successfully |
| EIP-712 `DOMAIN_SEPARATOR()` | ✅ Supported | Returned non-zero domain separator |
| EIP-712 `version()` | ✅ Supported | Returned `"2"` |
| EIP-2612 `permit(...)` | ✅ Supported | Method exists; invalid test signature reached signature validation path |
| EIP-2612 `nonces(address)` | ✅ Supported | Returned nonce for probed address |
| EIP-2612 `PERMIT_TYPEHASH()` | ✅ Supported | Returned standard permit typehash |
| EIP-3009 `transferWithAuthorization(...)` | ✅ Supported | Method exists; invalid test signature reached signature validation path |
| EIP-3009 `receiveWithAuthorization(...)` | ✅ Supported | Method exists; expired authorization reverted as expected |
| EIP-3009 `cancelAuthorization(...)` | ✅ Supported | Method exists and enters authorization validation path |
| EIP-3009 `authorizationState(address,bytes32)` | ✅ Supported | Returned unused authorization state for fresh nonce |
| Permit2 canonical deployment | ✅ Available | Code detected at canonical Permit2 address on Arc Testnet |
| Circle FiatToken admin surface | ✅ Present | `masterMinter()`, `isBlacklisted(address)`, `paused()` callable |

## Method Call Results

These probes were read-only `eth_call` checks against Arc Testnet USDC.

### ERC-20 / token metadata

- `name()` — returned successfully
- `symbol()` — returned successfully
- `decimals()` — returned successfully; ArcLayer treats USDC amounts as 6 decimals
- `totalSupply()` — returned successfully

### EIP-712

- `DOMAIN_SEPARATOR()` — returned a non-zero `bytes32`
- `version()` — returned `"2"`

Interpretation: Arc USDC exposes the EIP-712 domain required for typed-data authorization flows.

### EIP-2612 Permit

- `nonces(address)` — returned successfully for a probed account
- `PERMIT_TYPEHASH()` — returned successfully
- `permit(owner, spender, value, deadline, v, r, s)` — callable; invalid test signature reached the expected validation path instead of selector-not-found

Interpretation: Arc USDC supports permit-style off-chain approvals.

### EIP-3009 Authorization

- `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)` — callable; invalid test signature reached the expected validation path instead of selector-not-found
- `receiveWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)` — callable; expired authorization reverted as expected
- `cancelAuthorization(authorizer, nonce, v, r, s)` — callable; authorization validation path exists
- `authorizationState(authorizer, nonce)` — returned unused state for a fresh random nonce

Interpretation: Arc USDC supports the core primitive required by x402 `exact` payments.

### Permit2

- Canonical Permit2 address contained bytecode on Arc Testnet.

Interpretation: Permit2 is available as an additional compatibility path, but it is not the primary recommendation for x402 `exact` because EIP-3009 is directly supported by USDC.

## Recommendation

Use a dual-scheme facilitator model.

### Scheme 1: `arc-escrow`

ArcLayer-native flow:

1. Client creates/funds a `JobEscrow` job on-chain.
2. Client retries the protected request with `X-PAYMENT` containing the funding tx hash.
3. Facilitator verifies `JobFunded` on-chain.
4. Agent executes.
5. Deliverable + WorkProof + reputation remain preserved.

Use this for ArcLayer-native clients and console UX.

### Scheme 2: `exact`

Standard x402-compatible flow:

1. Client receives `402 Payment Required` with an `exact` payment requirement.
2. Client signs an EIP-3009 `transferWithAuthorization` typed-data payload for Arc USDC.
3. Relayer submits the payment on-chain.
4. Facilitator verifies settlement and maps the payment into ArcLayer job execution.

Use this for standard x402 clients, SDK integrations, and external paid APIs.

## Testnet / Demo Path

For grant/demo speed, use a 2-step relay first without redeploying contracts:

1. Relayer submits `USDC.transferWithAuthorization(client -> relayer, amount, ...)`.
2. Relayer funds the existing `JobEscrow` path via approve/fund or equivalent existing flow.

Tradeoff:

- ✅ Fastest to ship
- ✅ No contract redeploy required
- ✅ Good for testnet, demo, and grant milestone proof
- ⚠️ Relayer temporarily holds funds before forwarding into escrow

## Production Path

Deploy `JobEscrow V2` with a direct authorization funding method:

```solidity
function fundFromAuthorization(
    uint256 jobId,
    address from,
    uint256 value,
    uint256 validAfter,
    uint256 validBefore,
    bytes32 nonce,
    uint8 v,
    bytes32 r,
    bytes32 s
) external onlyRelayer {
    USDC.transferWithAuthorization(
        from,
        address(this),
        value,
        validAfter,
        validBefore,
        nonce,
        v,
        r,
        s
    );

    _fund(jobId, value);
}
```

Benefits:

- Atomic payment + escrow funding
- Non-custodial relayer path
- Preserves ArcLayer differentiator: USDC escrow + WorkProof + reputation
- Cleaner accounting for production facilitator fees

## Development Sequence

Recommended path after this spike:

1. PR 1 — Normalize x402 types, headers, and add `exact` scheme type support.
2. PR 2 — Lock `/api/x402/supported`, `/api/x402/verify`, `/api/x402/settle` schema and OpenAPI.
3. PR 2.5 — Add `@arclayer/x402` SDK skeleton.
4. PR 3 — Document dual scheme: `arc-escrow` + `exact`.
5. PR 4+5 — Implement `exact` scheme relay using EIP-3009.
6. Production later — upgrade to `JobEscrow V2 fundFromAuthorization(...)`.

## Grant Positioning

This PR 0 result removes the main technical blocker for ArcLayer as an Arc-native x402 facilitator:

- Arc USDC supports standard EIP-3009 authorization.
- Standard x402 `exact` clients can be supported.
- ArcLayer can still preserve its native escrow, WorkProof, and reputation layer.
- Testnet/demo can ship quickly with 2-step relay.
- Production has a clear non-custodial upgrade path through `JobEscrow V2`.
