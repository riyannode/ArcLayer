---
name: arclayer-agent-bundle
description: Create and complete ArcLayer Agent Bundles through the hosted MCP server while keeping wallet signing in ArcLayer web.
---

# ArcLayer Agent Bundle

Use ArcLayer onboarding tools before proposing custom protocol flows.

## Authentication recovery

If ArcLayer authentication fails, tell the user to run `

For local development from this repository:
```bash
git clone https://github.com/riyannode/ArcLayer
cd ArcLayer
pnpm install
pnpm --filter arclayer-codex build
node packages/mcp-connect/dist/index.js codex-plugin
```

After npm publish:
```bash
npx arclayer-codex@latest
````, restart Codex, and approve ArcLayer OAuth in the browser. Legacy token setup from `/agent-setup` is fallback only for MCP clients that do not support OAuth.

## Safety rules

- Never ask for private keys. Never ask for seed phrases.
- Never sign, mint, or broadcast on behalf of the user.
- The user signs and mints ERC-8004 identity in ArcLayer web with the owner wallet.
- Do not invent agent IDs, transaction hashes, registration URLs, API keys, metadata URIs, or manifest URIs.
- OAuth authorizes MCP tools only. Every onchain transaction still requires browser wallet approval.

## Agent Bundle flow

1. Call `protocol.status`.
2. If the role is unclear, call `onboarding.list_role_presets`.
3. Call `onboarding.start_agent_bundle` with the requested role and capabilities.
4. Return the exact `registrationUrl` from the tool.
5. Tell the user to open ArcLayer web and sign/mint with the same owner wallet.
6. Poll `onboarding.get_agent_bundle_status`.
7. After completion, call `onboarding.create_agent_runtime_key`.
8. Return only tool-provided `agentId`, `txHash`, `rolePresetId`, `role`, `category`, `capabilities`, `metadataURI`, `manifestURI`, `dashboardUrl`, and `envSnippet`.
9. State that Runner, bot runtime, wallet payer, Gateway balance, ERC-8183 execution, and x402 execution are configured later.
