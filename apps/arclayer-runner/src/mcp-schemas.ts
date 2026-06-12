/**
 * Runner-local MCP tool schemas.
 * Zod is the source of truth for both call-time validation and MCP JSON Schema.
 */

import { toJSONSchema, z, type ZodType } from "zod/v4";

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const emptyInput = z.object({}).strict();
const limitInput = z.object({
  limit: z.number().int().min(1).max(500).optional().describe("Maximum records to return (1-500)")
}).strict();
const arbitraryObject = z.record(z.string(), z.unknown());
const optionalBody = z.unknown().optional();

const providerRunInput = z.object({
  taskId: z.string(),
  jobId: z.string(),
  agentId: z.string(),
  provider: z.string(),
  description: z.string(),
  input: arbitraryObject
}).strict();

const jobWithOptParamsInput = z.object({
  jobId: z.string(),
  optParams: z.string().optional().describe("Optional params bytes (default: 0x)")
}).strict();

const jobReasonInput = z.object({
  jobId: z.string(),
  reason: z.string().describe("bytes32 hash or plaintext string"),
  optParams: z.string().optional().describe("Optional params bytes (default: 0x)")
}).strict();

const toolInputs = {
  "runner.health": emptyInput,
  "runner.manifest": emptyInput,
  "runner.skill": emptyInput,
  "runner.receipts": limitInput,
  "runner.ledger": limitInput,
  "runner.policy": emptyInput,
  "circle.status": emptyInput,
  "circle.gateway_balance": emptyInput,
  "circle.wallet_balance": emptyInput,
  "circle.wallet_budget": emptyInput,
  "circle.wallet_policy_status": emptyInput,
  "x402.inspect": z.object({
    url: z.string().url(),
    method: z.string().optional(),
    body: optionalBody
  }).strict(),
  "x402.pay": z.object({
    url: z.string().url(),
    method: z.string().optional(),
    maxAmountUsdc: z.string(),
    reason: z.string(),
    idempotencyKey: z.string().optional(),
    body: optionalBody
  }).strict(),
  "x402.batch_pay": z.object({
    batchId: z.string(),
    taskId: z.string(),
    payments: z.array(z.object({
      url: z.string().url(),
      method: z.string().optional(),
      maxAmountUsdc: z.string(),
      reason: z.string(),
      idempotencyKey: z.string().optional()
    }).strict()).min(1)
  }).strict(),
  "x402.list_receipts": limitInput,
  "x402.payment_policy": emptyInput,
  "erc8004.prepare_register": z.object({
    metadataURI: z.string().url().describe("Agent manifest URL")
  }).strict(),
  "erc8183.provider_run_job": providerRunInput,
  "erc8183.provider_submit_deliverable": z.object({
    jobId: z.string(),
    deliverableHash: z.string()
  }).strict(),
  "erc8183.provider_run_and_submit": providerRunInput,
  "erc8183.provider_runtime_status": emptyInput,
  "erc8183.create_job": z.object({
    provider: z.string().describe("Provider wallet address"),
    evaluator: z.string().describe("Evaluator wallet address"),
    expiredAt: z.string().describe("Job expiry as unix timestamp"),
    description: z.string().describe("Job description"),
    hook: z.string().optional().describe("Callback contract address (default: zero address)")
  }).strict(),
  "erc8183.set_budget": z.object({
    jobId: z.string(),
    amount: z.string().describe("Budget amount in USDC (6 decimals)"),
    optParams: z.string().optional().describe("Optional params bytes (default: 0x)")
  }).strict(),
  "erc8183.approve_usdc": z.object({
    amount: z.string().describe("Amount to approve in USDC (6 decimals)")
  }).strict(),
  "erc8183.fund_job": jobWithOptParamsInput,
  "erc8183.complete_job": jobReasonInput,
  "erc8183.reject_job": jobReasonInput,
  "erc8183.claim_refund": z.object({ jobId: z.string() }).strict(),
  "erc8183.set_provider": z.object({
    jobId: z.string(),
    provider: z.string().describe("Provider wallet address (0x...)")
  }).strict(),
  "erc8004.register_via_circle_cli": z.object({
    metadataURI: z.string().url().describe("Agent manifest URL")
  }).strict(),
  "circle.gateway_deposit": z.object({
    amount: z.string().describe("Amount in USDC"),
    method: z.enum(["eco", "direct"]).optional().describe("Deposit method")
  }).strict(),
  "runner.skills_list": emptyInput,
  "runner.skill_get": z.object({
    skillId: z.string().describe("Skill ID from manifest")
  }).strict(),
  "runner.skills_bundle": z.object({
    role: z.string().optional().describe("Role name (e.g. provider, client, evaluator)"),
    skillIds: z.array(z.string()).optional().describe("Specific skill IDs to bundle")
  }).strict(),
  "runner.role_profile": z.object({ role: z.string().describe("Role name") }).strict(),
  "runner.role_tools": z.object({ role: z.string().describe("Role name") }).strict()
} satisfies Record<string, ZodType>;

const toolDescriptions: Record<keyof typeof toolInputs, string> = {
  "runner.health": "Runner health check",
  "runner.manifest": "Runner manifest with capabilities",
  "runner.skill": "Global Agent Skill content and hash",
  "runner.receipts": "Recent receipts",
  "runner.ledger": "Recent spending ledger records",
  "runner.policy": "Current spending policy limits",
  "circle.status": "Circle CLI version, wallet status, gateway balance",
  "circle.gateway_balance": "Gateway balance for configured wallet",
  "circle.wallet_balance": "Wallet balance for configured wallet",
  "circle.wallet_budget": "Wallet budget/limit for configured wallet",
  "circle.wallet_policy_status": "Compare Runner policy vs Circle wallet policy caps + remaining budget",
  "x402.inspect": "Inspect x402 service (read-only, no payment)",
  "x402.pay": "Pay x402 service (requires paymentEnabled + wallet)",
  "x402.batch_pay": "Batch pay multiple x402 services",
  "x402.list_receipts": "List x402 payment receipts",
  "x402.payment_policy": "Current x402 payment policy (limits, hosts, enabled)",
  "erc8004.prepare_register": "Prepare ERC-8004 agent registration (unsigned calldata)",
  "erc8183.provider_run_job": "Dispatch job to LLM runtime (no on-chain submit)",
  "erc8183.provider_submit_deliverable": "Submit deliverable on-chain via Circle CLI",
  "erc8183.provider_run_and_submit": "Run job + submit deliverable (full lifecycle)",
  "erc8183.provider_runtime_status": "Provider runtime context from hosted MCP",
  "erc8183.create_job": "Create ERC-8183 job on-chain via Circle CLI. hook is an address (not bytes).",
  "erc8183.set_budget": "Set budget for an ERC-8183 job",
  "erc8183.approve_usdc": "Approve USDC for ERC-8183 AgenticCommerce contract. Must be called before fund_job.",
  "erc8183.fund_job": "Fund an ERC-8183 job. Requires prior approve_usdc.",
  "erc8183.complete_job": "Complete an ERC-8183 job (evaluator action). reason is bytes32 or string (auto-hashed).",
  "erc8183.reject_job": "Reject an ERC-8183 job (evaluator action). reason is bytes32 or string (auto-hashed).",
  "erc8183.claim_refund": "Claim refund for an expired ERC-8183 job (client action). Single arg — no optParams.",
  "erc8183.set_provider": "Assign provider to an open ERC-8183 job (client action). Job must be Open, provider must be 0x0.",
  "erc8004.register_via_circle_cli": "Register ERC-8004 identity on-chain via Circle CLI. Gated behind allowIdentityRegister.",
  "circle.gateway_deposit": "Deposit USDC into Circle Gateway. Gated behind allowGatewayDeposit. devops-admin only.",
  "runner.skills_list": "List all manifest skills with id, title, path, exists, sha256, roles, status",
  "runner.skill_get": "Get skill content by ID (content, sha256, path, roles, capabilities)",
  "runner.skills_bundle": "Bundle skills for a role or list of skill IDs (context only)",
  "runner.role_profile": "Role description, capabilities, tool groups, recommended setup",
  "runner.role_tools": "Callable tools enabled for a role"
};

export const RUNNER_MCP_TOOLS: McpToolDef[] = Object.entries(toolInputs).map(([name, schema]) => ({
  name,
  description: toolDescriptions[name as keyof typeof toolInputs],
  inputSchema: toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>
}));

export function parseMcpToolArgs(name: string, args: unknown): Record<string, unknown> {
  const schema = toolInputs[name as keyof typeof toolInputs];
  if (!schema) return (args ?? {}) as Record<string, unknown>;
  return schema.parse(args ?? {}) as Record<string, unknown>;
}
