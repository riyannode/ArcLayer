import { describe, it, expect } from "vitest";
import {
  getArcLayerToolsForRole,
  getRunnerRoleForSdkRole,
  listRolePresets,
} from "../roles.js";

describe("roles", () => {
  describe("getArcLayerToolsForRole", () => {
    it("read-only gets only inspect, receipts, ledger", () => {
      const tools = getArcLayerToolsForRole("read-only");
      expect(tools).toContain("arclayer_x402_inspect");
      expect(tools).toContain("arclayer_receipts");
      expect(tools).toContain("arclayer_spend_ledger");
      expect(tools).not.toContain("arclayer_x402_pay");
      expect(tools).not.toContain("arclayer_x402_batch_pay");
    });

    it("x402-agent gets pay + batch_pay + all read tools", () => {
      const tools = getArcLayerToolsForRole("x402-agent");
      expect(tools).toContain("arclayer_x402_inspect");
      expect(tools).toContain("arclayer_x402_pay");
      expect(tools).toContain("arclayer_x402_batch_pay");
      expect(tools).toContain("arclayer_receipts");
      expect(tools).toContain("arclayer_spend_ledger");
    });

    it("provider default gets run-only but not run-and-submit", () => {
      const tools = getArcLayerToolsForRole("provider");
      expect(tools).toContain("arclayer_x402_inspect");
      expect(tools).toContain("arclayer_receipts");
      expect(tools).toContain("arclayer_spend_ledger");
      expect(tools).toContain("arclayer_provider_run_only");
      expect(tools).not.toContain("arclayer_provider_run_and_submit");
      expect(tools).not.toContain("arclayer_x402_pay");
      expect(tools).not.toContain("arclayer_x402_batch_pay");
    });

    it("provider can opt into run-and-submit explicitly", () => {
      const tools = getArcLayerToolsForRole("provider", {
        enableProviderRunAndSubmit: true,
      });
      expect(tools).toContain("arclayer_provider_run_only");
      expect(tools).toContain("arclayer_provider_run_and_submit");
    });

    it("evaluator gets only read tools", () => {
      const tools = getArcLayerToolsForRole("evaluator");
      expect(tools).not.toContain("arclayer_x402_pay");
    });

    it("read-only does not include provider runtime tools", () => {
      const tools = getArcLayerToolsForRole("read-only");
      expect(tools).not.toContain("arclayer_provider_run_only");
      expect(tools).not.toContain("arclayer_provider_run_and_submit");
    });

    it("x402-agent does not include provider runtime tools", () => {
      const tools = getArcLayerToolsForRole("x402-agent");
      expect(tools).not.toContain("arclayer_provider_run_only");
      expect(tools).not.toContain("arclayer_provider_run_and_submit");
    });

    it("deniedTools removes tool even if role allows it", () => {
      const tools = getArcLayerToolsForRole("x402-agent", {
        deniedTools: ["arclayer_x402_batch_pay"],
      });
      expect(tools).toContain("arclayer_x402_pay");
      expect(tools).not.toContain("arclayer_x402_batch_pay");
    });

    it("deniedTools removes run-and-submit even when explicitly enabled", () => {
      const tools = getArcLayerToolsForRole("provider", {
        enableProviderRunAndSubmit: true,
        deniedTools: ["arclayer_provider_run_and_submit"],
      });
      expect(tools).toContain("arclayer_provider_run_only");
      expect(tools).not.toContain("arclayer_provider_run_and_submit");
      // Read tools still present
      expect(tools).toContain("arclayer_x402_inspect");
      expect(tools).toContain("arclayer_receipts");
      expect(tools).toContain("arclayer_spend_ledger");
    });

    it("allowedTools restricts to intersection with role", () => {
      const tools = getArcLayerToolsForRole("x402-agent", {
        allowedTools: ["arclayer_x402_inspect", "arclayer_receipts"],
      });
      expect(tools).toContain("arclayer_x402_inspect");
      expect(tools).toContain("arclayer_receipts");
      expect(tools).not.toContain("arclayer_x402_pay");
    });

    it("unknown role throws", () => {
      expect(() =>
        getArcLayerToolsForRole("unknown" as unknown as "read-only"),
      ).toThrow("Unknown role: unknown");
    });
  });

  describe("getRunnerRoleForSdkRole", () => {
    it("read-only returns undefined (SDK-only)", () => {
      expect(getRunnerRoleForSdkRole("read-only")).toBeUndefined();
    });

    it("x402-agent returns x402-agent", () => {
      expect(getRunnerRoleForSdkRole("x402-agent")).toBe("x402-agent");
    });

    it("provider returns provider", () => {
      expect(getRunnerRoleForSdkRole("provider")).toBe("provider");
    });

    it("evaluator returns evaluator", () => {
      expect(getRunnerRoleForSdkRole("evaluator")).toBe("evaluator");
    });

    it("client returns client", () => {
      expect(getRunnerRoleForSdkRole("client")).toBe("client");
    });
  });

  describe("listRolePresets", () => {
    it("returns all 5 roles", () => {
      const presets = listRolePresets();
      expect(presets).toHaveLength(5);
      expect(presets.map((p) => p.id)).toEqual([
        "read-only",
        "x402-agent",
        "provider",
        "evaluator",
        "client",
      ]);
    });

    it("each preset has id, title, description", () => {
      for (const preset of listRolePresets()) {
        expect(preset.id).toBeTruthy();
        expect(preset.title).toBeTruthy();
        expect(preset.description).toBeTruthy();
      }
    });
  });
});
