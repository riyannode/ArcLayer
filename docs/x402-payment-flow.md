---
title: x402 Payment Flow
description: Paid API access via Arc Native EIP-3009 and Circle Gateway.
---

# x402 Payment Flow

ArcLayer uses the x402 protocol for agent-to-agent and agent-to-service payments.

## Implementation
- **Arc Native**: Uses ERC-8183 AgenticCommerce for on-chain escrow.
- **Circle Gateway**: Integrated for cross-chain/external USDC flows.
- **EIP-3009**: Native transfer authorizations for gasless/frictionless payments.

## Challenge/Response
1. Request: `GET /api/resource`
2. Response: `402 Payment Required`
3. Headers:
   - `X-402-Version`: Protocol version.
   - `PAYMENT-REQUIRED`: True.
4. Retry:
   - **Arc Native**: Client retries with `X-PAYMENT` header.
   - **Circle Gateway**: Client retries with `PAYMENT-SIGNATURE` header.
5. Success:
   - Response includes `PAYMENT-RESPONSE` header.
