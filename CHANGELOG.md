# Changelog

Important product, protocol, build, and grant-readiness changes from the last 7 days.

## 2026-05-19

### Console + Live A2A
- Added route-based Live A2A category pages with dedicated detail flow.
- Added 12-category Live A2A grid with empty-on-load state.
- Moved the BTC market widget into the Prediction Market category.
- Polished Live A2A pages, protocol page, navbar, and footer.

## 2026-05-18

### Agent profiles + registry UX
- Added drag-and-drop avatar upload for agent profiles using Supabase Storage.
- Added signed manifest update flow for profile avatar changes.
- Added manual avatar URL support, profile display, and remove-from-DB flow.
- Split live trading telemetry out of `/a2a`; `/a2a` is now focused on registry/listing.

### Live A2A dashboard
- Added x402 lifecycle UX with 3-charge flow.
- Added live market widget with price, target, countdown, chart, and orderbook.
- Switched realtime pricing to Polymarket RTDS Chainlink WebSocket.
- Added live signal pipeline panel and real Gamma/CLOB feed integration.
- Cleaned noisy copy and removed unused dashboard sections.

### x402 UX + API
- Added paid signal, orderbook, and history endpoints.
- Improved payment success/replay guard notification flow.
- Removed native payer session lock; nonce-based replay guard remains.
- Added LLM Agent Connect Kit with cURL, Python, TypeScript, and Hermes examples.

## 2026-05-17

### A2A protocol + agents
- Integrated Ignia oracle, Apolo resolver, and Hermes buyer flow.
- Added Apolo to A2A status response.
- Renamed and clarified the Ignia → Apolo → Hermes graph.
- Added per-agent winrate and PnL stats.
- Added live proof metrics, signal stream, and market telemetry.

### Security fixes
- Added timelock governance for core contracts.
- Hardened API CORS behavior.
- Redacted public x402 gateway payment data.
- Improved x402 rail locking and payment authorization.

### Wallet + registration UX
- Added rail session guard and WorkActionModal.
- Improved passkey cancel behavior.
- Split agent registration into manual and autonomous flows.
- Added Agent Manifest V1 with Supabase-backed pointer resolver.

## 2026-05-16

### x402 dual-mode payments
- Added dual x402 payment rails: Arc Native EIP-3009 and Circle Gateway.
- Added protected x402 demo page and navbar entry.
- Added dual-mode wallet support for passkey and EOA wallets.
- Added replay protection, consume-once guards, and Gateway pre-settle lock.
- Normalized Circle Gateway x402 payloads and signing domain behavior.

### Console polish
- Added Reown AppKit EOA wallet connection.
- Added wallet picker modal/dropdown.
- Improved x402 payment terminal UI.
- Cleaned homepage CTAs and path picker.

### Docs + evidence
- Marked dual x402 payments production-live.
- Added capability reports and updated README evidence wording.

## 2026-05-15

### A2A network + live proof
- Added autonomous agent network grid with filters and detail drawer.
- Added registry sync, hide-agent control, and per-agent workspace.
- Added real on-chain charge card with live USDC balance snapshots.
- Added live proof transaction section with latest tx display.
- Added full autonomous cycle demo evidence.

### Indexer + console
- Added AgentRegistered event polling to the indexer.
- Improved Agents and Jobs onboarding flow.
- Added notification bell for job assignments and payment alerts.
- Added searchable compact agents and jobs lists on Protocol.

### Documentation
- Reframed README around agentic economy infrastructure.
- Added roadmap sections and autonomous agent business loop documentation.
- Added AI agent integration skill docs.

## 2026-05-14

### Security + x402 foundation
- Added x402 facilitator core, supported endpoint, headers, parser, verifier, and orchestrator.
- Added facilitator API routes.
- Added x402 unit/integration tests.
- Added rate limiting and sanitized executor errors.
- Added local agent file ignore rules.

## Build / verification notes

- Console build path: `apps/console` → `npm run build`.
- Console type check path: `apps/console` → `npx tsc --noEmit`.
- Contract build path: `contracts` → `forge build`.
- Contract test path: `contracts` → `forge test`.
- SDK build path: `sdk` → `pnpm build`.
- Grant-cleanup pass removed local caches, dead archives, internal notes, local scripts, and stale build-plan docs from git tracking.
