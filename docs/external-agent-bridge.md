# External Agent Bridge

ArcLayer is a pure protocol/payment/receipt bridge for autonomous agents. ArcLayer does **not** own trading strategy, LLM prompts, private keys, wallet execution, or market-specific decision logic.

## Architecture

### ArcLayer responsibilities

- Agent identity and API key authentication.
- x402 Arc Native payment gate for bridge session access.
- Event ingestion from external bots.
- Receipt storage and session history.
- Frontend display of external bot outputs.

### External PM2 bot responsibilities

- Oracle / market data logic.
- Momentum resolver logic.
- Scalping resolver logic.
- Evaluator rationale and scoring logic.
- Executor intent generation and DRY_RUN execution mode.
- LLM prompts and LLM API keys.
- Wallet/private key custody.
- Any future real execution logic, outside ArcLayer.

## Bot roles

Allowed bridge roles are protocol labels, not strategy implementations:

- `oracle`
- `momentum_resolver`
- `scalping_resolver`
- `evaluator`
- `executor`

Recommended event types:

- `signal`
- `rationale`
- `intent`
- `dry_run_order`
- `evaluation`
- `status`
- `error`

## Event payload schema

Endpoint:

```http
POST /api/agent-bridge/events
Authorization: Bearer <ARCLAYER_API_KEY>
Content-Type: application/json
```

Required scope:

- `agent_bridge:write`

Body:

```json
{
  "sessionId": "session_2026_05_22_001",
  "agentId": "agent_xxx",
  "role": "oracle",
  "type": "signal",
  "payload": {
    "market": "BTC 5m UP/DOWN",
    "summary": "External bot output only"
  },
  "payloadHash": "sha256-json-payload",
  "source": "pm2:oracle-worker",
  "dryRun": true
}
```

`payloadHash` should be computed by the external bot as:

```text
sha256(JSON.stringify(payload))
```

ArcLayer stores the event and displays it. ArcLayer must not infer strategy from the payload.

## Receipt payload schema

Endpoint:

```http
POST /api/agent-bridge/receipts
Authorization: Bearer <ARCLAYER_API_KEY>
Content-Type: application/json
```

Required scope:

- `agent_bridge:write` or `agent_bridge:receipt`

Body:

```json
{
  "sessionId": "session_2026_05_22_001",
  "receiptType": "payment",
  "paymentId": "pay_xxx",
  "transaction": "0x...",
  "payloadHash": "sha256-json-payload",
  "metadata": {
    "rail": "arc-native-eoa",
    "source": "PAYMENT-RESPONSE"
  }
}
```

## Latest session

Endpoint:

```http
GET /api/agent-bridge/sessions/latest
```

Returns latest bridge session grouped by role, plus attached receipts.

## x402 bridge access

Endpoint:

```http
POST /api/x402/bridge-access?rail=arc-native-eoa&payer=<wallet>
```

The route only verifies x402 payment and unlocks the latest bridge session:

```json
{
  "ok": true,
  "access": "unlocked",
  "session": {
    "sessionId": "session_...",
    "roles": {},
    "receipts": []
  }
}
```

The real payment proof is the `PAYMENT-RESPONSE` header. ArcLayer may attach payment response metadata to `agent_bridge_receipts`.

This route must not:

- Run trading logic.
- Run LLM prompts.
- Call Polymarket.
- Submit trades.
- Evaluate strategy.
- Execute wallet/private-key actions.

## API key scopes

Use explicit scopes:

- `agent_bridge:write` for event ingestion.
- `agent_bridge:receipt` for receipt-only writers.
- `agent_bridge:read` for future protected read endpoints.

Avoid generic broad scopes for bridge writers.

## Environment and secrets rules

External PM2 bots keep secrets in local runtime environment only, for example:

- PM2 ecosystem env files.
- VPS `.env` files.
- Local secret manager.

Never store these in Supabase:

- LLM API keys.
- Private keys.
- Seed phrases.
- Polymarket credentials.
- Wallet executor secrets.

Supabase stores bridge events, hashes, public/session metadata, and receipts only.

## PM2 runtime pattern

Each bot process should run independently and publish outputs to ArcLayer:

```text
oracle-worker              -> POST /api/agent-bridge/events role=oracle
momentum-resolver-worker   -> POST /api/agent-bridge/events role=momentum_resolver
scalping-resolver-worker   -> POST /api/agent-bridge/events role=scalping_resolver
evaluator-worker           -> POST /api/agent-bridge/events role=evaluator
executor-worker            -> POST /api/agent-bridge/events role=executor dryRun=true
```

The executor remains `DRY_RUN` for this implementation. Any future real order execution must remain outside `apps/console` and outside ArcLayer protocol routes.
