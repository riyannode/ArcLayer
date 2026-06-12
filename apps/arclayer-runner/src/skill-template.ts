/**
 * ArcLayer Runner skill template for Hermes/OpenClaw.
 *
 * This template is injected into the runtime's skill directory.
 * It instructs the LLM how to use ArcLayer Runner MCP tools.
 *
 * SECURITY: No secrets, private keys, OTP, or session tokens.
 * The skill only describes tool names and usage patterns.
 */

export function generateSkillTemplate(config: {
  agentId: string;
  runtimeTarget: string;
}): string {
  return `# ArcLayer Runner — Agent Skill

You are connected to ArcLayer Runner, a policy boundary for agentic commerce on Arc.

## Available MCP Tools

Your runtime calls these tools via \`arclayer-runner mcp\` (STDIO):

### Runner Introspection
- \`runner.health\` — Runner health check
- \`runner.manifest\` — Runner manifest with capabilities
- \`runner.receipts\` — List recent receipts (proofs of action)
- \`runner.ledger\` — List spending ledger records
- \`runner.policy\` — Current spending policy limits

### Circle Wallet
- \`circle.status\` — Circle CLI version, wallet status, gateway balance
- \`circle.gateway_balance\` — Gateway USDC balance
- \`circle.wallet_balance\` — Wallet USDC balance
- \`circle.wallet_budget\` — Remaining rolling-window budget
- \`circle.wallet_policy_status\` — Compare Runner policy vs Circle wallet policy

### x402 Payments
- \`x402.inspect\` — Inspect an x402 service (read-only, no payment)
- \`x402.pay\` — Pay an x402 service (requires paymentEnabled + wallet)
- \`x402.batch_pay\` — Batch pay multiple x402 services
- \`x402.list_receipts\` — List x402 payment receipts
- \`x402.payment_policy\` — Current x402 payment policy

### ERC-8004 Identity
- \`erc8004.prepare_register\` — Prepare agent registration (unsigned calldata)

### ERC-8183 Jobs
- \`erc8183.provider_run_job\` — Dispatch job to LLM runtime
- \`erc8183.provider_submit_deliverable\` — Submit deliverable on-chain
- \`erc8183.provider_run_and_submit\` — Full lifecycle: run + submit
- \`erc8183.provider_runtime_status\` — Provider runtime context

## x402 Usage

### Inspect first (free)
\`\`\`json
{ "name": "x402.inspect", "arguments": { "url": "https://arclayers.xyz/api/x402/protected-resource" } }
\`\`\`

### Pay (requires paymentEnabled)
\`\`\`json
{
  "name": "x402.pay",
  "arguments": {
    "url": "https://arclayers.xyz/api/x402/protected-resource",
    "maxAmountUsdc": "0.01",
    "reason": "access protected resource",
    "idempotencyKey": "my-unique-key-123"
  }
}
\`\`\`

**Required fields:** url, maxAmountUsdc, reason
**Optional:** idempotencyKey (prevents double-spend), method, body

### Batch pay
\`\`\`json
{
  "name": "x402.batch_pay",
  "arguments": {
    "batchId": "batch-001",
    "taskId": "t-001",
    "payments": [
      {
        "type": "x402_service_pay",
        "url": "https://arclayers.xyz/api/x402/protected-resource",
        "maxAmountUsdc": "0.01",
        "reason": "resource A",
        "idempotencyKey": "batch-001:item-0"
      }
    ]
  }
}
\`\`\`

## Usage Rules

1. **Never ask for private keys, seed phrases, or OTP.** Runner handles wallet operations safely.
2. **Check \`runner.policy\` before payments** to understand spending limits.
3. **Use \`x402.inspect\` first** before paying — inspect is free.
4. **Receipts are proofs** — use \`runner.receipts\` to verify completed actions.
5. **Daily/monthly limits are enforced** — if payment fails with DAILY_LIMIT_EXCEEDED, wait or adjust.

## Agent Info

- Agent ID: ${config.agentId}
- Runtime: ${config.runtimeTarget}
- MCP Transport: STDIO (local process isolation, no HTTP auth needed)
`;
}
