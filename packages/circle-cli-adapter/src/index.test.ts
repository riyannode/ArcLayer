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

    it("only allows submit and register signatures", async () => {
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
