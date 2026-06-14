import { describe, it, expect } from "vitest";
import {
  CircleCliAdapter,
  normalizeCircleTransaction,
  extractCircleTransactions,
  extractCircleTransactionId,
  extractCircleTxHash,
  extractCircleState,
  type CircleCliResult,
} from "./index";
import { RunnerError } from "@arclayer/runner-core";

function expectRunnerError(promise: Promise<unknown>, code: string) {
  return promise.then(
    () => expect.fail(`Expected RunnerError with code ${code}`),
    (error) => {
      expect(error).toBeInstanceOf(RunnerError);
      expect((error as RunnerError).code).toBe(code);
    }
  );
}

describe("CircleCliAdapter", () => {
  const adapter = new CircleCliAdapter({ bin: "circle" });

  describe("blocked commands", () => {
    it("blocks register via executeAllowedArcWrite by default", async () => {
      await expectRunnerError(
        adapter.executeAllowedArcWrite({
          signature: "register(string)",
          params: ["ipfs://metadata"],
          contract: "0x0000000000000000000000000000000000000001",
          address: "0x0000000000000000000000000000000000000002",
          chain: "ARC-TESTNET"
        }),
        "ERC8004_REGISTER_BLOCKED"
      );
    });

    it("allows register when explicitly enabled", async () => {
      // circle CLI not installed in test env — should fail with spawn error, NOT ERC8004_REGISTER_BLOCKED
      try {
        await adapter.executeAllowedArcWrite({
          signature: "register(string)",
          params: ["ipfs://metadata"],
          contract: "0x0000000000000000000000000000000000000001",
          address: "0x0000000000000000000000000000000000000002",
          chain: "ARC-TESTNET",
          allowRegister: true
        });
      } catch (error) {
        expect(error).not.toBeInstanceOf(RunnerError);
      }
    });

    it("only allows submit and register signatures via executeAllowedArcWrite", async () => {
      await expectRunnerError(
        adapter.executeAllowedArcWrite({
          // @ts-expect-error testing invalid signature
          signature: "transfer(address,uint256)",
          params: ["0x0000000000000000000000000000000000000001", "1000"],
          contract: "0x0000000000000000000000000000000000000001",
          address: "0x0000000000000000000000000000000000000002",
          chain: "ARC-TESTNET"
        }),
        "ARC_CONTRACT_METHOD_BLOCKED"
      );
    });
  });

  describe("ERC-8183 lifecycle allowlist", () => {
    it("blocks unknown ABI signatures via executeErc8183Write", async () => {
      await expectRunnerError(
        adapter.executeErc8183Write({
          signature: "transfer(address,uint256)",
          params: ["0x0000000000000000000000000000000000000001", "1000"],
          contract: "0x0000000000000000000000000000000000000001",
          address: "0x0000000000000000000000000000000000000002",
          chain: "ARC-TESTNET"
        }),
        "ERC8183_SIGNATURE_BLOCKED"
      );
    });

    it("blocks withdraw(address,uint256) via executeErc8183Write", async () => {
      await expectRunnerError(
        adapter.executeErc8183Write({
          signature: "withdraw(address,uint256)",
          params: ["0x0000000000000000000000000000000000000001", "1000"],
          contract: "0x0000000000000000000000000000000000000001",
          address: "0x0000000000000000000000000000000000000002",
          chain: "ARC-TESTNET"
        }),
        "ERC8183_SIGNATURE_BLOCKED"
      );
    });

    it("has correct createJob signature with address hook (not bytes)", () => {
      expect(CircleCliAdapter.ERC8183_SIGNATURES.has("createJob(address,address,uint256,string,address)")).toBe(true);
      expect(CircleCliAdapter.ERC8183_SIGNATURES.has("createJob(address,address,uint256,string,bytes)")).toBe(false);
    });

    it("has all expected lifecycle signatures", () => {
      const sigs = CircleCliAdapter.ERC8183_SIGNATURES;
      expect(sigs.has("submit(uint256,bytes32,bytes)")).toBe(true);
      expect(sigs.has("createJob(address,address,uint256,string,address)")).toBe(true);
      expect(sigs.has("setBudget(uint256,uint256,bytes)")).toBe(true);
      expect(sigs.has("fund(uint256,bytes)")).toBe(true);
      expect(sigs.has("complete(uint256,bytes32,bytes)")).toBe(true);
      expect(sigs.has("reject(uint256,bytes32,bytes)")).toBe(true);
      expect(sigs.has("claimRefund(uint256)")).toBe(true);
      expect(sigs.has("setProvider(uint256,address)")).toBe(true);
      expect(sigs.size).toBe(8);
    });
  });

  describe("gateway deposit method handling", () => {
    it("rejects eco method on ARC-TESTNET", async () => {
      await expectRunnerError(
        adapter.gatewayDeposit({
          amount: "1.0",
          address: "0x0000000000000000000000000000000000000002",
          chain: "ARC-TESTNET",
          method: "eco"
        }),
        "GATEWAY_DEPOSIT_METHOD_INVALID"
      );
    });

    it("defaults to direct method on ARC-TESTNET when method not specified", async () => {
      // Should not throw GATEWAY_DEPOSIT_METHOD_INVALID
      // Will fail at Circle CLI execution, but method validation passes
      try {
        await adapter.gatewayDeposit({
          amount: "1.0",
          address: "0x0000000000000000000000000000000000000002",
          chain: "ARC-TESTNET"
        });
      } catch (error) {
        expect(error).not.toBeInstanceOf(RunnerError);
      }
    });
  });

  describe("public API surface", () => {
    it("exposes all expected methods", () => {
      expect(adapter.version).toBeDefined();
      expect(adapter.walletStatus).toBeDefined();
      expect(adapter.walletBalance).toBeDefined();
      expect(adapter.walletBudget).toBeDefined();
      expect(adapter.gatewayBalance).toBeDefined();
      expect(adapter.inspectService).toBeDefined();
      expect(adapter.payService).toBeDefined();
      expect(adapter.executeAllowedArcWrite).toBeDefined();
      expect(adapter.executeErc8183Write).toBeDefined();
      expect(adapter.approveUsdc).toBeDefined();
      expect(adapter.gatewayDeposit).toBeDefined();
      expect(adapter.queryContract).toBeDefined();
    });

    it("does NOT expose import, sign, withdraw, transfer, swap", () => {
      expect((adapter as any).import).toBeUndefined();
      expect((adapter as any).sign).toBeUndefined();
      expect((adapter as any).withdraw).toBeUndefined();
      expect((adapter as any).transfer).toBeUndefined();
      expect((adapter as any).swap).toBeUndefined();
    });

    it("exposes transactionList and normalization helpers", () => {
      expect(adapter.transactionList).toBeDefined();
      expect(normalizeCircleTransaction).toBeDefined();
      expect(extractCircleTransactions).toBeDefined();
      expect(extractCircleTransactionId).toBeDefined();
      expect(extractCircleTxHash).toBeDefined();
      expect(extractCircleState).toBeDefined();
    });
  });

  describe("transaction normalization", () => {
    it("normalizes a flat transaction object", () => {
      const tx = normalizeCircleTransaction({
        id: "tx-001",
        txHash: "0xabc",
        state: "CONFIRMED",
        operation: "execute",
        contractAddress: "0xcontract",
        abiFunctionSignature: "fund(uint256,bytes)",
        createdAt: "2025-01-01T00:00:00Z",
      });
      expect(tx.id).toBe("tx-001");
      expect(tx.txHash).toBe("0xabc");
      expect(tx.state).toBe("confirmed");
      expect(tx.operation).toBe("execute");
    });

    it("normalizes nested data envelope", () => {
      const tx = normalizeCircleTransaction({
        data: {
          id: "tx-002",
          hash: "0xdef",
          status: "SENT",
        },
      });
      expect(tx.id).toBe("tx-002");
      expect(tx.txHash).toBe("0xdef");
      expect(tx.state).toBe("sent");
    });

    it("returns unknown for missing/empty input", () => {
      const tx = normalizeCircleTransaction(null);
      expect(tx.state).toBe("unknown");
      expect(tx.id).toBeUndefined();
    });

    it("maps all known states", () => {
      const states = [
        "INITIATED", "QUEUED", "SENT", "CONFIRMED", "COMPLETE",
        "FAILED", "CANCELLED", "DENIED", "CLEARED", "STUCK",
      ];
      for (const s of states) {
        const tx = normalizeCircleTransaction({ state: s });
        expect(tx.state).not.toBe("unknown");
      }
    });

    it("returns unknown for unrecognized state", () => {
      const tx = normalizeCircleTransaction({ state: "PENDING_REVIEW" });
      expect(tx.state).toBe("unknown");
    });
  });

  describe("extractCircleTransactions", () => {
    it("extracts from array response", () => {
      const result: CircleCliResult = {
        command: "circle",
        args: [],
        stdout: "[]",
        stderr: "",
        json: [{ id: "1", state: "CONFIRMED" }, { id: "2", state: "SENT" }],
      };
      const txs = extractCircleTransactions(result);
      expect(txs).toHaveLength(2);
      expect(txs[0].id).toBe("1");
    });

    it("extracts from { data: [...] } envelope", () => {
      const result: CircleCliResult = {
        command: "circle",
        args: [],
        stdout: "{}",
        stderr: "",
        json: { data: [{ id: "3", state: "FAILED" }] },
      };
      const txs = extractCircleTransactions(result);
      expect(txs).toHaveLength(1);
      expect(txs[0].state).toBe("failed");
    });

    it("extracts from { transactions: [...] } envelope", () => {
      const result: CircleCliResult = {
        command: "circle",
        args: [],
        stdout: "{}",
        stderr: "",
        json: { transactions: [{ id: "4" }] },
      };
      const txs = extractCircleTransactions(result);
      expect(txs).toHaveLength(1);
    });

    it("extracts from { data: { transactions: [...] } } envelope", () => {
      const result: CircleCliResult = {
        command: "circle",
        args: [],
        stdout: "{}",
        stderr: "",
        json: { data: { transactions: [{ id: "5" }] } },
      };
      const txs = extractCircleTransactions(result);
      expect(txs).toHaveLength(1);
    });

    it("returns empty for null json", () => {
      const result: CircleCliResult = {
        command: "circle",
        args: [],
        stdout: "",
        stderr: "",
      };
      expect(extractCircleTransactions(result)).toEqual([]);
    });
  });

  describe("extractCircleTransactionId/TxHash/State", () => {
    it("extracts from flat response", () => {
      const result: CircleCliResult = {
        command: "circle",
        args: [],
        stdout: "{}",
        stderr: "",
        json: { id: "tx-10", txHash: "0x123", state: "CONFIRMED" },
      };
      expect(extractCircleTransactionId(result)).toBe("tx-10");
      expect(extractCircleTxHash(result)).toBe("0x123");
      expect(extractCircleState(result)).toBe("confirmed");
    });

    it("extracts from nested data envelope", () => {
      const result: CircleCliResult = {
        command: "circle",
        args: [],
        stdout: "{}",
        stderr: "",
        json: { data: { id: "tx-11", hash: "0x456", status: "COMPLETE" } },
      };
      expect(extractCircleTransactionId(result)).toBe("tx-11");
      expect(extractCircleTxHash(result)).toBe("0x456");
      expect(extractCircleState(result)).toBe("complete");
    });

    it("returns undefined/unknown for missing fields", () => {
      const result: CircleCliResult = {
        command: "circle",
        args: [],
        stdout: "{}",
        stderr: "",
        json: {},
      };
      expect(extractCircleTransactionId(result)).toBeUndefined();
      expect(extractCircleTxHash(result)).toBeUndefined();
      expect(extractCircleState(result)).toBe("unknown");
    });
  });

  describe("blocked commands remain blocked", () => {
    it("blocks transaction cancel", async () => {
      await expectRunnerError(
        (adapter as any).run(["transaction", "cancel", "--id", "tx-1"]),
        "CIRCLE_COMMAND_BLOCKED"
      );
    });

    it("blocks transaction accelerate", async () => {
      await expectRunnerError(
        (adapter as any).run(["transaction", "accelerate", "--id", "tx-1"]),
        "CIRCLE_COMMAND_BLOCKED"
      );
    });

    it("blocks wallet import", async () => {
      await expectRunnerError(
        (adapter as any).run(["wallet", "import"]),
        "CIRCLE_COMMAND_BLOCKED"
      );
    });
  });
});
