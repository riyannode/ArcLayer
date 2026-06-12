import { describe, it, expect } from "vitest";
import { CircleCliAdapter } from "./index";
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
      expect(sigs.size).toBe(7);
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
  });
});
