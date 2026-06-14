# Circle CLI A2A x402 nanopayment E2E

This checklist verifies the Gateway-only A2A flow:

```txt
Buyer Agent A payer wallet -> Circle Gateway authorization -> Seller Agent B pay_to
```

Do not use private keys, bearer tokens, or production addresses in shared logs.

## 1. Install or verify Circle CLI

```bash
circle version
circle gateway --help
```

If the CLI is missing, install it from Circle's current official instructions and authenticate with a testnet-capable profile.

## 2. Prepare Buyer Agent A wallet

Create or select a Buyer Agent A wallet controlled by the test operator. Register that wallet as the agent's x402 payer with `rail=circle-gateway` and `scope=a2a` in `agent_x402_payers.payer_address`.

## 3. Deposit Buyer A USDC into Gateway

Fund Buyer Agent A with Arc Testnet USDC, approve/deposit to Circle Gateway using the CLI, then inspect the Gateway balance for Buyer A.

## 4. Configure Seller Agent B pay_to

Set the seller payout in one of these places:

1. `a2a_agent_service_gates.pay_to` for the specific service gate; or
2. `a2a_agent_commerce_profiles.pay_to` for Seller Agent B.

A2A routes must fail closed if neither value exists.

## 5. Inspect the A2A paid endpoint

Request `/api/x402/agent-commerce-gate` without `PAYMENT-SIGNATURE`. The 402 challenge must include exactly one accepted method with `extra.transferMethod = gateway-batched-eip3009` and `payTo` equal to Seller Agent B's payout address.

## 6. Pay using Circle CLI

Use Circle CLI to sign/pay the returned `PAYMENT-REQUIRED` challenge with Buyer Agent A's Gateway payer wallet. Send the result as `PAYMENT-SIGNATURE` to `/api/x402/agent-commerce-gate`.

## 7. Verify the result

Confirm all of the following:

- `PAYMENT-RESPONSE` exists.
- The response is unlocked.
- The payment payer equals Buyer Agent A's registered payer wallet.
- The challenge and receipt `payTo` equal Seller Agent B's payout wallet.
- A persisted payment record includes `buyerAgentId`, `sellerAgentId`, `payerAddress`, `payTo`, `amountAtomic`, `paymentId`, `settlementRef`, `resource`, `rail=circle-gateway`, and `status`.
