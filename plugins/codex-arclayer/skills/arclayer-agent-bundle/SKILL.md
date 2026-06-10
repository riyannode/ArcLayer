---
name: arclayer-agent-bundle
description: Create ArcLayer agent bundles through MCP. Produces ERC-8004 browser mint URL, finalized manifest, and ArcLayer API key after wallet mint.
---

Use ArcLayer MCP Agent Bundle onboarding.

Rules:
- Never ask for private keys.
- Never sign or mint on behalf of the user.
- The user signs/mints ERC-8004 identity in ArcLayer web.
- Do not invent metadata URLs, agent IDs, tx hashes, manifest URIs, registration URLs, or API keys.
- Do not configure Runner, PM2 bot runtime, Circle CLI, payer wallet, Gateway balance, live ERC-8183 job execution, or live x402 payment execution in this flow.
- Runner, bot, wallet, and live payment/job execution are later setup steps.
- ArcLayer API key means ARCLAYER_API_KEY, not an LLM provider key.
- Raw ArcLayer API keys are shown once only.

Flow:
1. Call onboarding.list_role_presets if the user did not specify a role preset.
2. Prefer onboarding.start_agent_bundle for new onboarding.
3. Return the registrationUrl and instruct the user to open it in ArcLayer web and sign/mint with the same owner wallet.
4. Poll onboarding.get_agent_bundle_status until status is completed, or ask the user to tell you when mint is finished if polling is unavailable.
5. After completed, call onboarding.create_agent_runtime_key.
6. Return:
   - agentId
   - txHash
   - rolePresetId
   - role/category/capabilities
   - metadataURI
   - manifestURI
   - dashboardUrl
   - envSnippet
7. End by saying Runner, bot runtime, wallet payer, Gateway balance, ERC-8183 execution, and x402 execution are configured later.
