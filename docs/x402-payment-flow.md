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
2. No payment: `402 Payment Required` with headers `X-402-Version` and `PAYMENT-REQUIRED`.
3. Arc Native retry header: `X-PAYMENT: <payment-payload>`.
4. Circle Gateway retry header: `PAYMENT-SIGNATURE: <signature>`.
5. Success responses include `PAYMENT-RESPONSE`.
