# Arc USDC Capability Report

Generated: `2026-05-16T06:34:31.570Z`
Probe: `scripts/probe-arc-usdc-capability.mjs` (read-only)

## Network

- Name: Arc Testnet
- Chain ID (declared): 5042002
- Chain ID (observed via `eth_chainId`): 5042002
- Latest block: 42461230
- RPC: https://rpc.testnet.arc.network
- Explorer: https://testnet.arcscan.app

## USDC

- Address: `0x3600000000000000000000000000000000000000`
- name(): USDC
- symbol(): USDC
- decimals(): 6
- DOMAIN_SEPARATOR(): `0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0`

## Standards

### EIP-3009 — transferWithAuthorization

- ✅ `authorizationState(address,bytes32)` returned data — function exists.

### EIP-2612 — permit

- ✅ `nonces(address)` returned 0 — function exists.

### Permit2 (Uniswap canonical)

- ✅ Deployed at `0x000000000022D473030F116dDEE9F6B43aC78BA3` (codeSize=9152).

## Decision

| Capability | Status |
|---|---|
| EIP-3009 | supported |
| EIP-2612 | supported |
| Permit2 | deployed |
| Preferred x402 V2 scheme | **eip3009** |

## Notes

- This probe does not write any state and does not require funded wallets.
- A successful `eth_call` to a selector indicates the function exists; full
  spec compliance still requires runtime testing (signature verification,
  nonce mechanics, replay protection).
- If `DOMAIN_SEPARATOR` is missing but `nonces`/`authorizationState` exist,
  the contract may build the domain inline per call — not a blocker.
- Re-run after any USDC contract upgrade on Arc Testnet.
