/**
 * Local Provider Service
 *
 * Runs LLM inference locally inside the provider runtime.
 * Replaces Runner /erc8183/provider/run-only.
 *
 * No Runner dependency. No HMAC. No remote HTTP.
 */

import { ChatOpenAI } from "@langchain/openai";
import { createHash } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────────

export type ProviderServiceInput = {
  jobId: string;
  prompt: string;
  agentId: string;
};

export type ProviderServiceResult = {
  deliverable: string;
  deliverableHash: `0x${string}`;
};

// ── Config ─────────────────────────────────────────────────────────────────

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "openai:gpt-4o";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

// ── Hash Helper ────────────────────────────────────────────────────────────

function keccak256Hex(data: string): `0x${string}` {
  // Use sha256 as a stand-in; viem keccak256 not needed here since
  // the contract accepts any bytes32 hash. sha256 is deterministic.
  const hash = createHash("sha256").update(data).digest("hex");
  return `0x${hash}`;
}

// ── Service ────────────────────────────────────────────────────────────────

/**
 * Run provider service: call LLM, produce deliverable, compute hash.
 * Deterministic — same input produces same output (modulo LLM nondeterminism).
 */
export async function runProviderService(
  input: ProviderServiceInput,
): Promise<ProviderServiceResult> {
  const { jobId, prompt, agentId } = input;

  process.stdout.write(
    `[provider-service] running LLM for job=${jobId} agent=${agentId} model=${OPENAI_MODEL}\n`,
  );

  const modelConfig: Record<string, unknown> = {
    model: OPENAI_MODEL.replace(/^openai:/, ""),
    temperature: 0.2,
    maxTokens: 4096,
  };

  if (OPENAI_API_KEY) {
    modelConfig.apiKey = OPENAI_API_KEY;
  }

  if (OPENAI_BASE_URL) {
    modelConfig.configuration = { baseURL: OPENAI_BASE_URL };
  }

  const model = new ChatOpenAI(modelConfig);

  const systemPrompt = [
    "You are an ArcLayer ERC-8183 provider agent.",
    "Process the job request and produce a deliverable.",
    "Return ONLY the deliverable content — no preamble, no explanation.",
    "Do not invent job IDs, wallet addresses, receipts, or tx hashes.",
  ].join("\n");

  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ]);

  const deliverable =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  const deliverableHash = keccak256Hex(deliverable);

  process.stdout.write(
    `[provider-service] deliverable hash=${deliverableHash.slice(0, 18)}... len=${deliverable.length}\n`,
  );

  return { deliverable, deliverableHash };
}
