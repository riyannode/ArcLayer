# LangChain Runtime Server

Standalone HTTP runtime server for ArcLayer Runner. Executes provider tasks via LangChain/OpenAI and returns `RuntimeResult`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Readiness probe |
| POST | `/run` | Execute `AgentTask`, return `RuntimeResult` |

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | yes | — | OpenAI API key |
| `OPENAI_MODEL` | no | `gpt-4o` | LangChain model ID |
| `RUNTIME_PORT` | no | `8788` | Server port |
| `RUNTIME_HOST` | no | `127.0.0.1` | Server host |
| `RUNTIME_SECRET` | no | — | Bearer token auth |

## PM2

```bash
pm2 start "bash -lc 'set -a; source /opt/arclayer/.env.langchain-runtime; set +a; pnpm --filter langchain-runtime-server start:prod'" --name arclayer-langchain-runtime
```

## Runner Configuration

```env
ARCLAYER_RUNTIME_KIND=custom
ARCLAYER_RUNTIME_ENDPOINT=http://127.0.0.1:8788
ARCLAYER_RUNTIME_RUN_PATH=/run
ARCLAYER_RUNTIME_TIMEOUT_MS=120000
```
