/**
 * Provider Write Adapter — Circle Dev Wallet SDK Implementation
 *
 * Uses @arclayer/circle-dev-wallet-adapter for direct on-chain writes.
 * Replaces Runner HTTP calls with Circle SDK contract execution.
 *
 * Key constraints (from PR #555 learnings):
 *   - Use pre-encoded callData for bytes/bytes32 params
 *   - No invalid non-UUID idempotencyKey
 *   - No unsupported blockchain field
 *   - Minimal request shape: {walletId, contractAddress, callData, fee}
 */

import { CircleDevWalletAdapter } from "@arclayer/circle-dev-wallet-adapter";
import { createPublicClient, http, parseAbi } from "viem";
import type {
  ProviderWriteAdapter,
  WriteResult,
  OnChainBudget,
} from "./provider-write-adapter.js";

// ── Arc Testnet Chain ──────────────────────────────────────────────────────

const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

// ── Config ─────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} is required for provider-write-circle`);
  return val;
}

// ── Adapter ────────────────────────────────────────────────────────────────

export class ProviderWriteCircle implements ProviderWriteAdapter {
  private adapter: CircleDevWalletAdapter;
  private contract: string;
  private rpcUrl: string;

  constructor(opts?: {
    contract?: string;
    rpcUrl?: string;
  }) {
    const apiKey = requireEnv("CIRCLE_API_KEY");
    const entitySecret = requireEnv("CIRCLE_ENTITY_SECRET");
    const walletId = requireEnv("CIRCLE_WALLET_ID");
    const walletAddress = requireEnv("CIRCLE_WALLET_ADDRESS");
    const chain = process.env.CIRCLE_CHAIN ?? "ARC-TESTNET";

    this.contract =
      opts?.contract ?? requireEnv("ARC_ERC8183_CONTRACT");
    this.rpcUrl =
      opts?.rpcUrl ?? process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network";

    this.adapter = new CircleDevWalletAdapter({
      apiKey,
      entitySecret,
      walletId,
      walletAddress,
      chain,
    });

    process.stdout.write(
      `[provider-write-circle] initialized contract=${this.contract} chain=${chain}\n`,
    );
  }

  // ── Submit ─────────────────────────────────────────────────────────────

  async submit(input: {
    jobId: string;
    deliverableHash: `0x${string}`;
    agentId: string;
  }): Promise<WriteResult> {
    const { jobId, deliverableHash } = input;

    process.stdout.write(
      `[provider-write-circle] submit job=${jobId} hash=${deliverableHash.slice(0, 18)}...\n`,
    );

    try {
      const result = await this.adapter.executeErc8183Write({
        signature: "submit(uint256,bytes32,bytes)",
        params: [jobId, deliverableHash, "0x"],
        contract: this.contract,
        address: process.env.CIRCLE_WALLET_ADDRESS ?? "",
        chain: process.env.CIRCLE_CHAIN ?? "ARC-TESTNET",
      });

      const json = (result.json ?? {}) as Record<string, unknown>;
      const data = (json["data"] ?? {}) as Record<string, unknown>;
      const ok = json["ok"] === true;
      const txHash = data["txHash"] as string | undefined;
      const state = data["state"] as string | undefined;

      if (ok && txHash) {
        process.stdout.write(
          `[provider-write-circle] submit OK tx=${txHash}\n`,
        );
      } else {
        process.stdout.write(
          `[provider-write-circle] submit result: ok=${ok} state=${state} txHash=${txHash ?? "none"}\n`,
        );
      }

      return {
        ok,
        txHash: txHash ?? undefined,
        operationState: state,
        error: ok ? undefined : `state=${state}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[provider-write-circle] submit ERROR: ${msg}\n`);
      return { ok: false, error: msg };
    }
  }

  // ── Set Budget ─────────────────────────────────────────────────────────

  async setBudget(input: {
    jobId: string;
    amount: string;
    reason?: string;
  }): Promise<WriteResult> {
    const { jobId, amount, reason } = input;

    process.stdout.write(
      `[provider-write-circle] setBudget job=${jobId} amount=${amount}\n`,
    );

    try {
      // setBudget(uint256 jobId, uint256 amount, bytes optParams)
      // amount in USDC with 6 decimals
      const amountAtomic = BigInt(Math.round(parseFloat(amount) * 1_000_000));
      const reasonBytes = reason
        ? `0x${Buffer.from(reason).toString("hex")}`
        : "0x";

      const result = await this.adapter.executeErc8183Write({
        signature: "setBudget(uint256,uint256,bytes)",
        params: [jobId, amountAtomic.toString(), reasonBytes],
        contract: this.contract,
        address: process.env.CIRCLE_WALLET_ADDRESS ?? "",
        chain: process.env.CIRCLE_CHAIN ?? "ARC-TESTNET",
      });

      const json = (result.json ?? {}) as Record<string, unknown>;
      const data = (json["data"] ?? {}) as Record<string, unknown>;
      const ok = json["ok"] === true;
      const txHash = data["txHash"] as string | undefined;
      const state = data["state"] as string | undefined;

      return {
        ok,
        txHash: txHash ?? undefined,
        operationState: state,
        error: ok ? undefined : `state=${state}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[provider-write-circle] setBudget ERROR: ${msg}\n`);
      return { ok: false, error: msg };
    }
  }

  // ── Check On-Chain Budget ──────────────────────────────────────────────

  async checkOnChainBudget(jobId: string): Promise<OnChainBudget> {
    try {
      const client = createPublicClient({
        chain: ARC_TESTNET,
        transport: http(this.rpcUrl),
      });

      // jobInfo(uint256) returns (address client, address provider, address evaluator, uint256 budget, uint256 fundedAmount, uint8 status, bytes32 deliverableHash)
      const abi = parseAbi([
        "function jobInfo(uint256 jobId) view returns (address client, address provider, address evaluator, uint256 budget, uint256 fundedAmount, uint8 status, bytes32 deliverableHash)",
      ]);

      const result = await client.readContract({
        address: this.contract as `0x${string}`,
        abi,
        functionName: "jobInfo",
        args: [BigInt(jobId)],
      });

      const [/* client */, /* provider */, /* evaluator */, budget, fundedAmount, status, /* deliverableHash */] = result as [
        string, string, string, bigint, bigint, number, string,
      ];

      const hasBudget = budget > 0n;
      const budgetAtomic = budget.toString();
      const budgetUsdc = hasBudget
        ? (Number(budget) / 1_000_000).toFixed(6)
        : "0";

      process.stdout.write(
        `[provider-write-circle] checkBudget job=${jobId} hasBudget=${hasBudget} budget=${budgetUsdc} status=${status}\n`,
      );

      return { hasBudget, budgetAtomic, budgetUsdc };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[provider-write-circle] checkBudget ERROR: ${msg}\n`,
      );
      return { hasBudget: false, budgetAtomic: "0", budgetUsdc: "0" };
    }
  }
}
