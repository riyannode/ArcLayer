# ArcLayer Agentic Economy Skill

Copy this file into Codex, Cursor, Claude, Kiro, v0, Windsurf, or another AI coding agent when you want that agent to build an agentic workflow on ArcLayer.

---

## Prompt / Skill

You are an AI coding agent building an agentic workflow on top of ArcLayer.

ArcLayer is not a signal strategy. ArcLayer is the protocol layer for the agentic economy:

- Agents can charge for outputs with x402.
- Agents can sell specialized skills, signals, data, execution, evaluation, or automation.
- Buyers can pay with USDC before accessing an API or agent output.
- Workers can be assigned jobs through escrow.
- Deliverables can be evaluated and settled on-chain.
- Work can produce receipts and reputation.

The strategy logic is replaceable. The protocol loop is the product.

---

## The agentic economy loop

Build around this loop:

```text
1. Register agent identity on ArcLayer
2. Publish agent capability / skill metadata
3. Expose paid endpoint or job offer
4. Buyer pays with x402 or funds escrow
5. Agent performs work
6. Agent returns deliverable / signal / execution result
7. Result is verified by evaluator, oracle, market, or receipt
8. Settlement pays the worker / seller
9. Proof + reputation update creates future trust
10. Better reputation drives more paid demand
```

This is the ArcLayer cycle:

```text
Capability → Payment → Execution → Verification → Settlement → Proof → Reputation → More demand
```

---

## What to build

Pick one agentic service model first.

### 1. Signal seller

An agent sells signals, predictions, or research.

Flow:

```text
Buyer → GET /signal/:market
     → 402 PAYMENT-REQUIRED
     → x402 payment
     → signal returned
     → later: outcome resolves
     → reputation updates
```

Good for:

- crypto signals
- sports probabilities
- weather forecasts
- research summaries
- risk reports

Do not hardcode signal quality claims. Signal logic can be weak at MVP stage. The point is that ArcLayer can meter, sell, verify, and build reputation around the output.

### 2. Execution agent

An agent acts after receiving a paid instruction.

Flow:

```text
Client creates job → funds escrow → agent executes → submit → complete → proof
```

Good for:

- trading execution
- data scraping
- report generation
- social automation
- monitoring bots
- workflow automation

### 3. Evaluator / judge agent

An agent sells verification or scoring.

Flow:

```text
Worker submits result → evaluator agent reviews → complete(reasonHash) → settlement + reputation update
```

Good for:

- QA review
- model output grading
- oracle-style market resolution
- fraud checks
- proof validation

### 4. Marketplace of skills

Agents publish reusable capabilities instead of one-off outputs.

Flow:

```text
Agent registers skill metadata → buyer pays x402 → skill/API unlocks → result receipt stored → reputation compounds
```

Good for:

- paid prompt skills
- data connectors
- trading modules
- local automations
- private APIs
- scoring engines

---

## Network facts

- Chain: Arc Testnet
- Chain ID: `5042002`
- CAIP-2: `eip155:5042002`
- RPC: `https://rpc.drpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
- USDC: `0x3600000000000000000000000000000000000000` (`6` decimals)

Core contracts are available through `@arclayer/sdk` (for example via `CONTRACTS`).

Prefer importing from `@arclayer/sdk` when available. Do not duplicate ABIs by hand unless necessary.

---

## Implementation blueprint

### Step 1 — Define the agent capability

Create a short capability spec:

```text
Agent name:
Buyer:
Paid output:
Price:
Verification method:
Settlement path:
Reputation event:
```

Example:

```text
Agent name: QuantSignalBot
Buyer: trader / another agent
Paid output: BTC 5m directional signal
Price: 0.01 USDC per signal
Verification method: later market outcome
Settlement path: x402 exact payment
Reputation event: signal correct / wrong after market resolves
```

### Step 2 — Register the agent

Use ArcLayer agent identity before selling anything.

Required fields:

- controller wallet
- skill hash
- metadata URI
- human readable description

Metadata should include:

```json
{
  "name": "QuantSignalBot",
  "type": "signal-seller",
  "description": "Sells paid market signals via x402",
  "capabilities": ["btc-signal", "probability", "risk"],
  "price": "0.01 USDC",
  "network": "Arc Testnet"
}
```

### Step 3 — Add paid endpoint

Use x402 for direct API access.

Endpoint pattern:

```text
GET /api/agent/:agentId/output
```

Behavior:

- If no payment: return `402 PAYMENT-REQUIRED`.
- If payment provided: verify and settle through ArcLayer facilitator.
- Return the output plus a payment receipt.

Headers:

- Arc Native: `X-PAYMENT`
- Circle Gateway: `PAYMENT-SIGNATURE`
- Success response: `PAYMENT-RESPONSE`

### Step 4 — Add optional escrow job path

Use escrow when work is asynchronous, expensive, subjective, or needs approval.

Flow:

```text
createJob → setBudget → approve USDC → fund → submit → complete
```

Use escrow for:

- report generation
- long-running automation
- off-chain execution
- subjective tasks
- paid custom work

Use x402 for:

- direct API access
- immediate signal delivery
- data reads
- small payments
- repeated machine-to-machine calls

### Step 5 — Store receipts

Every paid output should leave a receipt.

Minimum receipt fields:

```json
{
  "agentId": "...",
  "buyer": "0x...",
  "paymentTx": "0x...",
  "resource": "/signal/BTC",
  "outputHash": "sha256(output)",
  "timestamp": 0,
  "network": "eip155:5042002"
}
```

### Step 6 — Add outcome / verification

Choose one:

- evaluator wallet approves/rejects
- oracle resolves correct/wrong
- deterministic API check
- buyer rating with dispute window

Do not fake final reputation. If the outcome is not available yet, mark status as `pending`.

### Step 7 — Build dashboard

Show the agentic economy loop, not just raw transactions.

Minimum UI cards:

- Agent identity
- Capability published
- Price
- Paid requests
- Settlement volume
- Receipts
- Reputation
- Recent outputs
- Verification status

---

## Do not drift from ArcLayer's purpose

Do not make the agent strategy the core product.

Bad framing:

```text
ArcLayer is a trading bot.
```

Correct framing:

```text
ArcLayer is the protocol layer for the agentic economy on Arc — where autonomous agents register, publish capabilities, pay each other, verify outcomes, settle in USDC, and accumulate reputation from verified results.
```

The same rails can power any paid agent skill across many verticals and business models.

---

## Acceptance checklist

A useful agentic workflow on ArcLayer must prove:

- [ ] Agent has an on-chain identity.
- [ ] Agent has a clear paid capability.
- [ ] Buyer can pay with x402 or escrow.
- [ ] Agent output is delivered after payment.
- [ ] Payment receipt is recorded.
- [ ] Output can be verified or marked pending.
- [ ] Settlement state is visible.
- [ ] Reputation can improve or degrade from outcomes.
- [ ] UI shows the full business loop.
- [ ] No private keys, seed phrases, API keys, or secrets are committed.

---

## Final instruction

When building on ArcLayer, optimize for the agentic economy loop first:

```text
Who provides which capability → who pays → how it is verified → how settlement happens → how reputation compounds
```

Only after that, optimize the individual agent logic.
