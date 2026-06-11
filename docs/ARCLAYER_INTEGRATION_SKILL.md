# ArcLayer Integration Skill

> **Canonical rules moved to [`docs/ARCLAYER_GLOBAL_AGENT_SKILL.md`](./ARCLAYER_GLOBAL_AGENT_SKILL.md).**
>
> Use the Global Agent Skill for allowed/forbidden actions, ERC-8004 identity rules, ERC-8183 job rules, x402 paid access rules, Circle Gateway / Agent Wallet / CLI boundaries, Runner boundaries, Hermes and OpenClaw runtime boundaries, and proof/receipt behavior.
>
> This file is kept as a backward-compatible quickstart and legacy reference.

---

ArcLayer is a protocol layer for ERC-8004 agent identity, ERC-8183 paid jobs, x402 payments, autonomous PM2 provider/evaluator agents, and browser-wallet client signing on Arc Testnet USDC.

## Core Rule

Do not invent signing flows.

ArcLayer has two different execution models:

1. Human client actions use browser-wallet signing through ArcLayer Profile Client Mode.
2. Autonomous provider/evaluator actions use dedicated runtime wallets in PM2 bots.

MCP prepares actions. Wallets sign them.

## Client Wallet Flow

Client actions include:

* createJob
* approve USDC
* fund job
* optional manual complete/reject if the human client is also evaluator

Client signing flow:

1. User opens ArcLayer Profile in a browser.
2. User connects browser wallet.
3. User switches to Client Mode.
4. User starts an MCP Client Signing Session.
5. MCP client uses the sessionId to request a signing action.
6. ArcLayer Profile shows the signing modal.
7. User approves in browser wallet.
8. MCP polls the request status and receives txHash/result.

Important:

* The MCP server does not hold the client private key.
* The MCP server does not directly sign client transactions.
* Browser/Profile tab must stay open for signing requests to appear.
* Claude mobile app does not support running ArcLayer MCP pairing directly.
* Claude Desktop, Cursor, or another local MCP-capable client is required for MCP tool execution.

If the user is on Claude mobile, instruct them to use the web UI manually or move to a desktop/local MCP client.

## Provider Runtime Flow

Provider actions include:

* setBudget
* submitDeliverable

Current production runtime:

* Dedicated provider EOA operational wallet.
* Runs as PM2 provider runtime bot.
* Signs only provider-side ERC-8183 actions.
* Must not use the client wallet, evaluator wallet, or owner/main wallet.

Provider lifecycle:

1. Bot discovers assigned/open jobs.
2. Bot sets budget when job is Open.
3. Client funds the job.
4. Bot executes task with LLM.
5. Bot submits deliverable hash.
6. Evaluator completes or rejects.

## Evaluator Runtime Flow

Evaluator actions include:

* complete
* reject

Current production runtime:

* Dedicated evaluator EOA operational wallet.
* Runs as PM2 evaluator runtime bot.
* Uses LLM evaluation.
* Signs only complete/reject.
* Must not use the client wallet, provider wallet, or owner/main wallet.

Evaluator lifecycle:

1. Bot discovers Submitted jobs assigned to evaluator.
2. Bot verifies on-chain evaluator address.
3. Bot runs LLM evaluation.
4. If confidence is high enough, bot signs complete or reject.
5. If confidence is low, bot marks needs_review and does not sign.
6. Bot checkpoints to prevent duplicate transactions.

## Circle Wallet Status

Circle/passkey Agent Wallet is supported for user-owned/manual Agent Account flows.

Current autonomous provider/evaluator runtimes do not use delegated Circle Agent Wallet execution yet.

Circle delegated/session execution for headless PM2 bots is planned, but must remain not_configured until Circle exposes or confirms a supported delegated/session executor path.

## ERC-8004 Identity

Use ArcLayer’s current SDK/address helpers as the canonical source.

Do not hardcode alternate contract addresses.

ERC-8004 identity registration:

* register metadata
* derive agent id from mint/Transfer tokenId
* controller may be EOA or Agent Wallet depending on flow

## ERC-8183 Job Lifecycle

ERC-8183 lifecycle:

1. createJob
2. provider setBudget
3. client approve USDC
4. client fund
5. provider submit deliverable
6. evaluator complete or reject
7. timeout refund only when applicable

Important:

* Provider must call setBudget before client can fund.
* Client fund bundle must not include provider-only setBudget.
* Rejected jobs are refunded by reject.
* Timeout refund applies to Funded/Submitted jobs after expiry.

## MCP Tool Usage

Prefer registered ArcLayer MCP tools instead of constructing calldata manually.

Client web-sign tools:

* client.request_create_job_web_sign
* client.request_fund_job_web_sign
* client.get_signing_request_status

Provider tools:

* provider.prepare_set_budget_for_session
* provider.prepare_submit_job_for_session

Evaluator tools:

* evaluator.prepare_complete_job
* evaluator.prepare_reject_job

Job/read tools:

* jobs.list_public
* jobs.get_onchain_status
* jobs.get

## x402

ArcLayer supports x402 Arc Native payment flows and optional Circle Gateway support where documented.

For x402 pay-to configuration, require:

* X402_RECEIVER_ADDRESS
* or X402_PAY_TO

Do not mix x402 payment with ERC-8183 escrow funding unless the flow explicitly says so.

## Safety Rules

Never ask for user private keys.

Never ask users to paste seed phrases.

Never tell users that Claude mobile can run MCP pairing.

Never reuse one wallet for client, provider, and evaluator roles.

Never sign arbitrary transactions.

Never call unregistered tools.

Never claim Circle delegated runtime support until it is implemented and verified.

## MCP

Claude mobile can help explain ArcLayer, but it cannot run local MCP tools or maintain ArcLayer MCP pairing.

For MCP pairing, use:

* Claude Desktop with MCP config
* Cursor or another MCP-capable desktop client
* a local/server MCP bridge explicitly configured for ArcLayer

For mobile-only use, use ArcLayer web UI manually.
