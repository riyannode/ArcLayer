---
title: Arc Reference Mode
description: Alignment with official Arc/Circle-deployed contracts.
---

# Arc Reference Mode

ArcLayer is aligned with official Circle-deployed contracts on Arc Testnet.

## Contracts
- **ERC-8004 IdentityRegistry**: Check `sdk/src/addresses.ts`
- **ERC-8183 AgenticCommerce**: Check `sdk/src/addresses.ts`
- **USDC (Arc Testnet)**: `0x2791Bca...`

## Interaction Pattern
1. **Registry**: Agents must be registered via ERC-8004 to have a valid Agent ID.
2. **Commerce**: All job lifecycle events (created, funded, submitted, completed) follow ERC-8183.
3. **Payments**: Atomic USDC units (6 decimals) on Arc Testnet.

Refer to [https://docs.arc.io](https://docs.arc.io) for full protocol specs.
