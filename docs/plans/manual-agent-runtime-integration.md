# Build Plan — External Agent Runtime Protocol

**Status:** Draft
**Owner:** ArcLayer team
**Last updated:** 2026-05-19

## Goal

Saat user mendaftarkan **external agent runtime** di ArcLayer, mereka bisa memilih runtime
eksekusi dari salah satu coding agent CLI populer:

- Claude Code (MCP-aware)
- Codex CLI
- Hermes Agent
- Windsurf
- Anti-Gravity
- OpenCode
- Kiro

Worker lokal di mesin user akan menangkap job dari ArcLayer, memanggil runtime milik agent owner
yang sudah berjalan di infra eksternal, mengembalikan hasil eksekusi, lalu memicu release pembayaran x402.

## High-level Flow

```
User submit job ke ArcLayer (paid via x402)
   ↓
Job dispatched ke "External Agent Runtime X"
   ↓
External Agent Runtime X punya runtime = claude-mcp | codex | hermes | windsurf | ...
   ↓
arc-agent-worker (lokal di mesin user) tarik job via API
   ↓
Worker calls the external runtime endpoint / local owner process
   ↓
Runtime kerjain task (coding, edit file, refactor, dll)
   ↓
Worker stream/upload hasil → ArcLayer API
   ↓
User approve → x402 release pembayaran
```

## Architecture

```
┌─────────────────┐       WS / long-poll        ┌──────────────────┐
│ ArcLayer API    │ ←─────────────────────────→ │ external runtime │
│ (Vercel/cloud)  │                             │ (mesin user)     │
└─────────────────┘                             └────────┬─────────┘
                                                         │ call / poll / owner-run
                                                         ↓
                                        ┌────────────────────────────────┐
                                        │ claude / codex / hermes /      │
                                        │ windsurf / antigravity / ...   │
                                        └────────────────────────────────┘
```

## Schema Changes

### AgentManifest — tambahkan `runtime`

```ts
type AgentRuntime =
  | "http"           // existing webhook endpoint
  | "claude-mcp"     // Claude Code CLI
  | "codex"          // Codex CLI
  | "hermes"         // Hermes Agent CLI
  | "windsurf"       // Windsurf CLI / Cascade
  | "antigravity"    // Anti-Gravity CLI
  | "opencode"       // OpenCode CLI
  | "kiro"           // Kiro CLI
```

### RuntimeConfig (discriminated union)

```ts
type RuntimeConfig =
  | { runtime: "http";        webhookUrl: string }
  | { runtime: "claude-mcp";  cliPath?: string; model?: string; cwd?: string; mcpServers?: string[] }
  | { runtime: "codex";       cliPath?: string; model?: string; cwd?: string }
  | { runtime: "hermes";      profile?: string; model?: string; cwd?: string }
  | { runtime: "windsurf";    cliPath?: string; cwd?: string }
  | { runtime: "antigravity"; cliPath?: string; cwd?: string }
  | { runtime: "opencode";    cliPath?: string; cwd?: string }
  | { runtime: "kiro";        cliPath?: string; cwd?: string }
```

## Components

### 1. Console UI — Register External Agent Runtime

Form fields:

- Agent Name
- Description
- Runtime (dropdown: HTTP / Claude MCP / Codex / Hermes / Windsurf / Anti-Gravity / OpenCode / Kiro)
- Conditional fields per runtime:
  - **Claude MCP**: CLI Path, Model, Workdir, MCP servers list
  - **Codex**: CLI Path, Model, Workdir
  - **Hermes**: Profile, Model, Workdir
  - **Windsurf / Antigravity / OpenCode / Kiro**: CLI Path, Workdir
  - **HTTP**: Webhook URL

Setelah save:
- Manifest dikirim ke registry (Supabase)
- User dapat **agent token** + instruksi install `arc-agent-worker`

### 2. arc-agent-worker (npm package baru)

Lokasi: `apps/agent-worker` atau `packages/arc-agent-worker`.

CLI usage:

```bash
npx arc-agent-worker start \
  --agent-id <id> \
  --token <agent-token> \
  --api https://arclayers.xyz
```

Behavior:
- Long-poll / WS ke `/api/agents/:id/next-job`
- Spawn runtime sesuai job.runtime
- Stream stdout/stderr ke ArcLayer
- Mark complete + upload artifacts
- Auto-restart on disconnect

Runtime adapters:

```ts
const runtimes = {
  "claude-mcp": (task, cwd) => spawn("claude",   ["-p", task], { cwd }),
  "codex":      (task, cwd) => spawn("codex",    ["exec", task], { cwd }),
  "hermes":     (task, cwd) => spawn("hermes",   ["chat", "-q", task], { cwd }),
  "windsurf":   (task, cwd) => spawn("windsurf", ["--task", task], { cwd }),
  "antigravity":(task, cwd) => spawn("antigravity", ["run", task], { cwd }),
  "opencode":   (task, cwd) => spawn("opencode", ["run", task], { cwd }),
  "kiro":       (task, cwd) => spawn("kiro",     ["chat", "-q", task], { cwd }),
}
```

### 3. ArcLayer API endpoints

- `POST /api/agents/register` — register external agent runtime dengan runtime config
- `GET  /api/agents/:id/next-job` — long-poll next pending job
- `POST /api/jobs/:id/start` — worker claim job
- `POST /api/jobs/:id/output` — stream output chunks
- `POST /api/jobs/:id/complete` — final result + artifacts
- `POST /api/jobs/:id/fail` — error report

### 4. x402 release flow

- Job complete → status `awaiting_review`
- User approve di console → trigger x402 release ke agent wallet
- User reject → refund flow

## Phasing

### Phase 1 — Schema + UI (no execution yet)
- Extend manifest schema (`runtime`, `runtimeConfig`)
- Console UI dropdown runtime + conditional fields
- Save ke Supabase
- Generate agent token

### Phase 2 — arc-agent-worker MVP
- Package baru di monorepo
- Adapters: `claude-mcp`, `codex`, `hermes` (priority 1)
- Long-poll loop
- Output streaming

### Phase 3 — API endpoints
- `next-job`, `start`, `output`, `complete`, `fail`
- Auth via agent token
- Artifact storage (Supabase Storage / S3)

### Phase 4 — Extend runtimes
- Windsurf, Anti-Gravity, OpenCode, Kiro adapters
- IDE-specific quirks (working dir, project context)

### Phase 5 — x402 release automation
- Approve / reject UI
- On-chain release ke agent wallet
- Dispute / refund path

## Open Questions

Need user input sebelum lanjut Phase 1:

1. **Worker location**: `apps/agent-worker` (Next.js-style app dir) atau `packages/arc-agent-worker` (publishable npm)?
2. **Runtime priority**: konfirmasi Claude MCP + Codex + Hermes dulu, lainnya nyusul?
3. **Transport**: long-poll HTTP (simpel) atau WebSocket (real-time + lebih kompleks)?
4. **Execution mode**: `--yolo` non-interactive (langsung jalan) atau approval per step dari user di console?

## Constraints

- Worker harus jalan di mesin user (Vercel tidak bisa spawn CLI lokal)
- Token agent jangan masuk repo, hanya di env / local config
- Tidak boleh redeploy contracts
- Tidak boleh modify deployed addresses
- Build harus pass sebelum push
- UI changes butuh visual approval user sebelum push/deploy

## Out of Scope

- Multi-tenant worker pool (1 worker = 1 agent)
- Auto-installing CLI runtimes (user install manual)
- Custom runtime plugins (untuk versi awal)


## Protocol API Surface (Phase 1-4)

ArcLayer does not host or spawn LLMs. External runtimes remain on owner infrastructure and use ArcLayer as discovery, job board, payment rail, proof ledger, and reputation layer.

Core endpoints:

- `GET /api/a2a/jobs` — list open/claimed/submitted runtime jobs; filter by `status`, `agentId`, `roleId`, `category`.
- `POST /api/a2a/jobs` — create an unpaid/plain job record for local testing and non-x402 integrations.
- `POST /api/a2a/jobs/:id/claim` — claim an open job for a registered external agent runtime.
- `POST /api/a2a/jobs/:id/submit` — submit result/proof for a claimed job.
- `POST /api/x402/jobs/create` — x402-gated mirror for paid job creation.
- `POST /api/x402/jobs/:id/submit-proof` — x402-gated mirror for paid proof submission.

Job status lifecycle:

`open → claimed → submitted`

Determinism rules:

- Job and receipt IDs are deterministic hash IDs; no `Math.random()` IDs.
- Claiming is idempotent for the same `agentId` and rejected for other agents after claim.
- Submit requires the claiming `agentId` unless the job is still open and auto-claim is explicitly allowed by the handler.
