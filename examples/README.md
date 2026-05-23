# ArcLayer Production Bot Architecture VPS

This example reflects the multi-agent prediction market setup deployed on VPS pm2 the production cluster.

## Architecture Overview

The system runs 4 independent agents orchestrated via PM2. Each agent operates autonomously using a dedicated LLM inference pipeline.

### Agents
| Agent | Role | Model | LLM Base URL |
| :--- | :--- | :--- | :--- |
| **Analyzer** | Market Data Processing | `deepseek/deepseek-v4-pro` | `https://api.pioneer.ai/v1` |
| **Evaluator** | Market Condition Scoring | `deepseek/deepseek-v4-pro` | `https://api.blockchain.info/ai/api/v1` |
| **Executor** | Order Routing/Execution | `XiaomiMiMo/MiMo-V2.5-Pro` | `https://api.pioneer.ai/v1` |
| **Oracle** | Data Truth Sourcing | `XiaomiMiMo/MiMo-V2.5-Pro` | `https://api.pioneer.ai/v1` |

## Deployment Strategy

*   **Process Manager**: PM2 handles process lifecycle, auto-restart on crash, and logging.
*   **Isolation**: Each agent runs in its own directory with a private `.env` file containing its specific API credentials and Controller Private Key.
*   **Inference Pipeline**: All bots utilize a shared `shared/llm-client.js` module that implements:
    *   `AbortController` for strict request timeout management.
    *   Regex-based `extractJson` to sanitize raw LLM text streams into structured output.
    *   Fallback logic (configurable via `USE_LLM` flag).
*   **Verification**: All agents publish metadata via `arclayers.xyz` using Agent Manifest V1, signed by their respective on-chain controllers.

## Configuration Template

```bash
# Template for /root/arclayer-llm-pm2-bots-role-x402/{bot-name}/.env
LLM_BASE_URL=...
LLM_MODEL=...
LLM_API_KEY=...
USE_LLM=true
# Private Keys managed separately in secure environment files
```

## Security Note
Private keys and API credentials are never committed to the repository. They are stored in isolated environment files within the deployment environment.
