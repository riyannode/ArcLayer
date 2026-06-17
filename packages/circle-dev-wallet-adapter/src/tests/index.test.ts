import { describe, it, expect } from "vitest";
import { CircleDevWalletAdapter } from "../index";
import type { WalletExecutionAdapter } from "@arclayer/runner-core";

describe("CircleDevWalletAdapter", () => {
  const baseOpts = {
    apiKey: "test-api-key:1:secret",
    entitySecret: "abcdef1234567890abcdef1234567890",
    walletId: "test-wallet-id",
    walletAddress: "0x1234567890123456789012345678901234567890",
    chain: "ARC-TESTNET",
  };

  describe("constructor", () => {
    it("throws when apiKey is missing", () => {
      expect(() => new CircleDevWalletAdapter({ ...baseOpts, apiKey: "" }))
        .toThrow("circleApiKey is required");
    });

    it("throws when entitySecret is missing", () => {
      expect(() => new CircleDevWalletAdapter({ ...baseOpts, entitySecret: "" }))
        .toThrow("circleEntitySecret is required");
    });

    it("throws when walletId is missing", () => {
      expect(() => new CircleDevWalletAdapter({ ...baseOpts, walletId: "" }))
        .toThrow("circleWalletId is required");
    });

    it("throws when walletAddress is missing", () => {
      expect(() => new CircleDevWalletAdapter({ ...baseOpts, walletAddress: "" }))
        .toThrow("circleWalletAddress is required");
    });

    it("creates adapter with valid options", () => {
      const adapter = new CircleDevWalletAdapter(baseOpts);
      expect(adapter).toBeDefined();
    });
  });

  describe("version", () => {
    it("returns adapter version info", async () => {
      const adapter = new CircleDevWalletAdapter(baseOpts);
      const result = await adapter.version!();
      expect(result.command).toBe("circle-dev-wallet-adapter");
      expect(result.json).toHaveProperty("adapter", "circle-dev");
    });
  });

  describe("executeErc8183Write", () => {
    it("blocks non-allowlisted signatures", async () => {
      const adapter = new CircleDevWalletAdapter(baseOpts);
      await expect(
        adapter.executeErc8183Write({
          signature: "transfer(address,uint256)" as any,
          params: ["0xabc", "100"],
          contract: "0x1234567890123456789012345678901234567890",
          address: baseOpts.walletAddress,
          chain: "ARC-TESTNET",
        })
      ).rejects.toThrow("not in the ERC-8183 lifecycle allowlist");
    });
  });

  describe("executeAllowedArcWrite", () => {
    it("blocks register without allowRegister flag", async () => {
      const adapter = new CircleDevWalletAdapter(baseOpts);
      await expect(
        adapter.executeAllowedArcWrite!({
          signature: "register(string)",
          params: ["ipfs://metadata"],
          contract: "0x1234567890123456789012345678901234567890",
          address: baseOpts.walletAddress,
          chain: "ARC-TESTNET",
        })
      ).rejects.toThrow("ERC-8004 register execution is blocked");
    });

    it("blocks non-allowlisted Arc signatures", async () => {
      const adapter = new CircleDevWalletAdapter(baseOpts);
      await expect(
        adapter.executeAllowedArcWrite!({
          signature: "transfer(address,uint256)" as any,
          params: ["0xabc", "100"],
          contract: "0x1234567890123456789012345678901234567890",
          address: baseOpts.walletAddress,
          chain: "ARC-TESTNET",
        })
      ).rejects.toThrow("Only allowlisted ArcLayer contract methods");
    });
  });

  describe("optional methods", () => {
    it("inspectService is not implemented (undefined)", () => {
      const adapter: WalletExecutionAdapter = new CircleDevWalletAdapter(baseOpts);
      expect(adapter.inspectService).toBeUndefined();
    });

    it("payService is not implemented (undefined)", () => {
      const adapter: WalletExecutionAdapter = new CircleDevWalletAdapter(baseOpts);
      expect(adapter.payService).toBeUndefined();
    });

    it("gatewayDeposit is not implemented (undefined)", () => {
      const adapter: WalletExecutionAdapter = new CircleDevWalletAdapter(baseOpts);
      expect(adapter.gatewayDeposit).toBeUndefined();
    });

    it("gatewayBalance is not implemented (undefined)", () => {
      const adapter: WalletExecutionAdapter = new CircleDevWalletAdapter(baseOpts);
      expect(adapter.gatewayBalance).toBeUndefined();
    });
  });
});
