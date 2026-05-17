# ArcLayer A2A Next Build Plan

Status anchor: `/a2a` stats are now live. Pythia `recordInteraction()` writes ReputationRegistry successfully after `pm2 restart pythia`. Keep slogan unchanged: `Protocol layer for agentic economy`.

## Non-negotiables

- Do not replace slogan: `Protocol layer for agentic economy`.
- Do not call ArcLayer a hackathon project.
- Use `agentic economy`, not `business loop`.
- Use `WorkProof`, not `Proof of Work`.
- `/a2a` = Autonomous Agent Network, agent-driven.
- `/jobs` = Manual Agent Jobs, human-driven.
- Homepage/nav must never be locked by x402. Public read-only stays public.
- x402 gates execution actions only.
- Do not touch deployed contracts, ABI/address SDK public signatures, x402 verify/settle logic unless explicitly asked.
- Never print/commit secrets, private keys, env files, `.agents/`, temp scripts, or X402 plan files.

## Current Done

- `/a2a` top stats now increment via Pythia -> ReputationRegistry.
- Pythia service restarted and confirmed log:
  - `[Pythia] Reputation recorded tx=0x3f11b99ca2ce9311b719b80e2b21eecd11c2db956e57b3311e60723641d3685e`
- `/a2a` cleanup done:
  - Trade Cycle removed.
  - Contracts section removed.
  - Placeholder sections removed.
  - Connection badges added.
  - Spacing between live reads and Marketplace Jobs fixed.
- `/jobs` copy changed to Manual Agent Jobs.
- WorkProof wording applied.

## Step 2 — Audit and complete `/jobs` flow

Goal: verify and complete the manual job lifecycle:

1. Pick agent.
2. Fill job form.
3. Pay / fund escrow.
4. Submit job.
5. Evaluate / attach result.
6. Release payout.
7. Show receipt / WorkProof / explorer proof.

Files to inspect first:

- `apps/console/src/app/jobs/page.tsx`
- `apps/console/src/app/jobs/create/page.tsx` if exists
- `apps/console/src/app/jobs/[id]/page.tsx` if exists
- `apps/console/src/components/jobs/**`
- `apps/console/src/lib/jobs/**`
- contract helpers around JobEscrow / WorkProof

Required output:

- If flow already complete: add only missing cross-links and copy polish.
- If incomplete: patch smallest missing pieces.
- Do not redesign page.
- Verify with `npx -p typescript@5.5.4 tsc --noEmit -p apps/console/tsconfig.json` or from `apps/console`.

Acceptance:

- A user can create a job with an agent preselected.
- Job page shows status clearly.
- Release/evaluate action has clear transaction feedback.
- Receipt / WorkProof / explorer link visible after completion.

## Step 3 — Build universal agent profile `/a2a/agents/[id]`

Goal: dedicated page for every agent, accessible from `/a2a` card and `/jobs` agent name.

Route:

- `apps/console/src/app/a2a/agents/[id]/page.tsx`

Tabs:

1. Profile
   - name
   - role
   - wallet / agent id
   - status
   - capabilities
   - connected agents
2. Reputation
   - calls served
   - success / delivery metrics
   - trust score / reputation stats
   - on-chain source note
3. A2A Activity
   - autonomous interactions
   - Pythia/Hermes receipts
   - ReputationRegistry events if available
4. Job History
   - manual jobs linked to this agent
   - completed / active / failed
5. Receipts
   - x402 payment receipts
   - WorkProof / escrow receipts
   - explorer links

Implementation guidance:

- Reuse existing `/a2a` data builder functions where possible.
- Do not duplicate large agent mapping logic inside page.
- Prefer a small shared helper like `getAgentByIdOrAddress()` if needed.
- If events are unavailable, show graceful empty state, not placeholder marketing copy.
- Keep ArcLayer dark style: `#0A0A0A` bg, `#C5A67C` accent.

Acceptance:

- `/a2a/agents/<pythia-id>` loads.
- `/a2a/agents/<hermes-id>` loads.
- Invalid id returns clean notFound or clear empty state.
- Tabs render without client crash.

## Step 4 — Cross-linking

Add links:

### From `/a2a`

- On agent drawer/card/profile:
  - `View profile` -> `/a2a/agents/[id]`
  - `Hire this agent` -> `/jobs/create?agent=[id]`

### From `/jobs`

- On job card / agent label:
  - `View agent profile` -> `/a2a/agents/[id]`
  - `View autonomous activity` -> `/a2a?focus=[id]`

### `/a2a?focus=ID`

- If query param exists:
  - visually highlight focused agent card
  - optionally open drawer if current UX supports it safely
  - do not break normal filters/search

Acceptance:

- Clicking from `/a2a` to profile works.
- Clicking `Hire this agent` preselects agent on create job page.
- Clicking from `/jobs` to A2A focus works.

## Step 5 — Homepage update

Goal: update homepage framing without touching the signature slogan.

Keep exact slogan:

- `Protocol layer for agentic economy`

Homepage should communicate:

- ArcLayer is protocol layer for autonomous agent commerce.
- Pythia/Hermes are reference implementations.
- x402 handles paid API/signal access.
- JobEscrow + WorkProof handles manual paid agent work.
- A2A Reputation tracks autonomous interactions.

CTA structure:

Primary CTAs:

- `Explore Autonomous Agents` -> `/a2a`
- `Create Paid Agent Job` -> `/jobs`

Secondary links:

- `x402 demo` -> `/x402-demo`
- `Docs` -> `/docs`

Do not add noisy CTA overload.
Do not remove honeycomb/brand visual.
Do not gate homepage.

Acceptance:

- Slogan unchanged.
- CTA points to `/a2a` and `/jobs`.
- No hackathon wording.
- No “business loop” wording.

## Step 6 — Split agent registration (manual vs autonomous)

Goal: Replace single `/agents` register form with clearer onboarding flow that distinguishes manual marketplace agents from autonomous A2A agents.

Routes:

- `/register` — Chooser landing (2 cards: Manual vs Autonomous)
- `/register/manual` — Manual marketplace agent form (port from current `/agents`)
- `/register/autonomous` — Autonomous A2A agent guided integration + form
- `/agents` — List-only (registered agents grid), CTA to `/register`

Chooser page (`/register`):

- Hero: "Register an agent on ArcLayer"
- 2 large cards side-by-side:
  - **Manual Agent** → `/register/manual`
    - Hired via JobEscrow
    - Client posts job, agent submits deliverable
    - Settled with WorkProof NFT receipt
  - **Autonomous Agent** → `/register/autonomous`
    - Runs own service (x402 endpoint)
    - Discoverable in A2A network
    - Earns from per-call payments
- Footer link: "Not sure? Read [docs/agent-types]"

Manual register (`/register/manual`):

- Same form as current `/agents` register section
- Fields: name, skill, metadata URI
- Submits `registerAgent(...)` on AgentRegistry
- After success → redirect to `/agents` or `/jobs`

Autonomous register (`/register/autonomous`):

- Step 1: Honest disclaimer
  - "ArcLayer does not host your agent yet."
  - "You run your own agent service."
  - "ArcLayer registers identity + metadata on-chain."
- Step 2: Choose integration mode
  - x402 Seller (paid endpoint)
  - Consumer/Trader (calls others)
  - Hybrid
- Step 3: Required inputs
  - Agent name
  - Skill / capability
  - Public endpoint URL
  - Metadata URI (auto-built or custom)
  - Pricing (`0.01 USDC/call`)
  - Categories
  - `autonomous: true` flag in metadata
- Step 4: Pre-register checklist (visual ✓ list)
- Step 5: Starter code snippet (copyable)
- Step 6: Submit `registerAgent(...)` with autonomous metadata
- After success → link to `/a2a?focus=[id]`

Implementation guidance:

- Reuse `nameToAgentId`, `buildAgentMetadataURI`, `buildRegisterAgentConfig` from existing SDK/lib.
- Extract shared `RegisterAgentForm` component if useful.
- Autonomous metadata JSON should include `autonomous: true`, `endpoint`, `pricing`, `categories`.
- Build-agent-network.ts already filters on `metadata.autonomous === true`.
- Update homepage and `/agents` CTAs to point to `/register`.
- Update `/a2a` CTA: "Register Autonomous Agent" → `/register/autonomous`.

Acceptance:

- `/register` loads chooser.
- `/register/manual` registers manual agent successfully.
- `/register/autonomous` registers autonomous agent with `autonomous: true` metadata.
- Newly-registered autonomous agent appears in `/a2a` network within indexer cycle.
- Newly-registered manual agent appears in `/agents` list.
- TypeScript clean.
- Build clean (17/17 → 19/19 routes).


From repo root:

```bash
cd /root/ArcLayer

git status --short
cd apps/console
npx -p typescript@5.5.4 tsc --noEmit -p tsconfig.json
npm run build
```

After changes:

```bash
cd /root/ArcLayer
git status --short
git diff --stat
git diff --check
```

Commit style:

```bash
git add <specific files>
git commit -m "feat(a2a): add agent profiles and cross-links"
git push origin main
```

## Resume prompt / command

Use this in Telegram:

`JOSH_RESUME_A2A_NEXT_BUILDPLAN`

When user sends that, load this file and execute Step 2 -> Step 5 in order, preserving all non-negotiables.
