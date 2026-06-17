# langchain-provider-agent

Minimal PM2-compatible ERC-8183 provider agent using `@arclayer/langchain-adapter`.

## What This Is

A reference implementation for running ERC-8183 provider jobs through ArcLayer Runner with a LangChain agent. Uses an external LLM API (OpenAI) — no local model.

## Safety

- `ENABLE_AUTO_SUBMIT=false` (default): only `arclayer_provider_run_only` is available. The model cannot call `run_and_submit`.
- `ENABLE_AUTO_SUBMIT=true`: maps to `enableProviderRunAndSubmit: true` — both tools become available.
- `TASK_SOURCE=none` (default): idle loop, keeps process alive for PM2.
- `TASK_SOURCE=static`: one-shot from `STATIC_PROVIDER_JOB_JSON`, then idle.

## Setup

```bash
cp .env.example .env
# Edit .env with your actual values
pnpm install
pnpm build
```

## Run

```bash
# Development
pnpm start

# PM2
pm2 start dist/index.js --name arclayer-provider-agent
pm2 save
pm2 logs arclayer-provider-agent
```

## Environment

| Variable | Required | Default | Description |
|---|---|---|---|
| `ARCLAYER_RUNNER_URL` | No | `http://127.0.0.1:8787` | Runner HTTP URL |
| `ARCLAYER_RUNNER_SECRET` | **Yes** | — | Runner HMAC secret |
| `OPENAI_API_KEY` | **Yes** | — | OpenAI API key |
| `OPENAI_MODEL` | No | `openai:gpt-4o` | Model string |
| `ENABLE_AUTO_SUBMIT` | No | `false` | Set `"true"` to expose `run_and_submit` |
| `TASK_SOURCE` | No | `none` | `"none"` or `"static"` |
| `TASK_POLL_INTERVAL_MS` | No | `30000` | Poll interval in ms |
| `STATIC_PROVIDER_JOB_JSON` | No | — | JSON for static test task |
