import { describe, it, expect } from "vitest";
import {
  getArcLayerToolsForRole,
  getRunnerRoleForSdkRole,
  listRolePresets,
} from "../roles.js";

describe("roles", () => {
  describe("getArcLayerToolsForRole", () => {
    it("read-only gets only inspect, receipts, ledger, job status, lifecycle", () => {
      const tools = getArcLayerToolsForRole("read-only");
      expect(tools).toContain("x402_inspect");
      expect(tools).toContain("payment_receipts");
      expect(tools).toContain("payment_spend_ledger");
      expect(tools).toContain("erc8183_job_status");
      expect(tools).toContain("erc8183_job_lifecycle_summary");
      expect(tools).not.toContain("x402_pay");
      expect(tools).not.toContain("x402_batch_pay");
    });

    it("x402-agent gets pay + batch_pay + all read tools", () => {
      const tools = getArcLayerToolsForRole("x402-agent");
      expect(tools).toContain("x402_inspect");
      expect(tools).toContain("x402_pay");
      expect(tools).toContain("x402_batch_pay");
      expect(tools).toContain("payment_receipts");
      expect(tools).toContain("payment_spend_ledger");
    });

    it("provider default gets run-only but not run-and-submit", () => {
      const tools = getArcLayerToolsForRole("provider");
      expect(tools).toContain("x402_inspect");
      expect(tools).toContain("payment_receipts");
      expect(tools).toContain("payment_spend_ledger");
      expect(tools).toContain("erc8183_provider_run_only");
      expect(tools).toContain("erc8183_provider_quote_job");
      expect(tools).not.toContain("erc8183_provider_run_and_submit");
      expect(tools).not.toContain("x402_pay");
      expect(tools).not.toContain("x402_batch_pay");
    });

    it("provider default includes all runtime tools", () => {
      const tools = getArcLayerToolsForRole("provider");
      expect(tools).toContain("erc8183_provider_get_context");
      expect(tools).toContain("erc8183_provider_get_resume_plan");
      expect(tools).toContain("erc8183_provider_heartbeat");
      expect(tools).toContain("erc8183_provider_start_job");
      expect(tools).toContain("erc8183_provider_write_checkpoint");
      expect(tools).toContain("erc8183_provider_retry_job");
      expect(tools).toContain("erc8183_provider_complete_run");
    });

    it("provider default includes all marketplace tools", () => {
      const tools = getArcLayerToolsForRole("provider");
      expect(tools).toContain("erc8183_provider_list_assigned_jobs");
      expect(tools).toContain("erc8183_provider_list_assigned_jobs_extended");
      expect(tools).toContain("erc8183_provider_list_open_jobs");
      expect(tools).toContain("erc8183_provider_list_my_open_job_applications");
      expect(tools).toContain("erc8183_provider_apply_open_job");
      expect(tools).toContain("erc8183_provider_withdraw_open_job_application");
    });

    it("provider default includes job status and lifecycle", () => {
      const tools = getArcLayerToolsForRole("provider");
      expect(tools).toContain("erc8183_job_status");
      expect(tools).toContain("erc8183_job_lifecycle_summary");
    });

    it("provider default does NOT include on-chain write tools", () => {
      const tools = getArcLayerToolsForRole("provider");
      expect(tools).not.toContain("erc8183_provider_publish_deliverable");
      expect(tools).not.toContain("erc8183_provider_submit_deliverable");
      expect(tools).not.toContain("erc8183_provider_set_budget");
      expect(tools).not.toContain("erc8183_provider_run_and_submit");
    });

    it("provider can opt into publish_deliverable", () => {
      const tools = getArcLayerToolsForRole("provider", {
        enableProviderPublishDeliverable: true,
      });
      expect(tools).toContain("erc8183_provider_publish_deliverable");
    });

    it("provider can opt into submit_deliverable", () => {
      const tools = getArcLayerToolsForRole("provider", {
        enableProviderSubmitDeliverable: true,
      });
      expect(tools).toContain("erc8183_provider_submit_deliverable");
    });

    it("non-provider roles cannot access provider runtime tools", () => {
      for (const role of ["read-only", "x402-agent", "evaluator", "client"] as const) {
        const tools = getArcLayerToolsForRole(role);
        expect(tools).not.toContain("erc8183_provider_get_context");
        expect(tools).not.toContain("erc8183_provider_heartbeat");
        expect(tools).not.toContain("erc8183_provider_start_job");
        expect(tools).not.toContain("erc8183_provider_list_assigned_jobs");
        expect(tools).not.toContain("erc8183_provider_apply_open_job");
      }
    });

    it("non-provider roles cannot access provider on-chain tools even with opt-in flags", () => {
      // Opt-in flags only work for provider role
      for (const role of ["read-only", "x402-agent", "evaluator", "client"] as const) {
        const tools = getArcLayerToolsForRole(role, {
          enableProviderRunAndSubmit: true,
          enableProviderSetBudget: true,
          enableProviderPublishDeliverable: true,
          enableProviderSubmitDeliverable: true,
        });
        expect(tools).not.toContain("erc8183_provider_run_and_submit");
        expect(tools).not.toContain("erc8183_provider_set_budget");
        expect(tools).not.toContain("erc8183_provider_publish_deliverable");
        expect(tools).not.toContain("erc8183_provider_submit_deliverable");
      }
    });

    it("provider can opt into run-and-submit explicitly", () => {
      const tools = getArcLayerToolsForRole("provider", {
        enableProviderRunAndSubmit: true,
      });
      expect(tools).toContain("erc8183_provider_run_only");
      expect(tools).toContain("erc8183_provider_run_and_submit");
    });

    it("evaluator gets only read tools", () => {
      const tools = getArcLayerToolsForRole("evaluator");
      expect(tools).not.toContain("x402_pay");
    });

    it("read-only does not include provider runtime tools", () => {
      const tools = getArcLayerToolsForRole("read-only");
      expect(tools).not.toContain("erc8183_provider_run_only");
      expect(tools).not.toContain("erc8183_provider_run_and_submit");
    });

    it("x402-agent does not include provider runtime tools", () => {
      const tools = getArcLayerToolsForRole("x402-agent");
      expect(tools).not.toContain("erc8183_provider_run_only");
      expect(tools).not.toContain("erc8183_provider_run_and_submit");
    });

    it("deniedTools removes tool even if role allows it", () => {
      const tools = getArcLayerToolsForRole("x402-agent", {
        deniedTools: ["x402_batch_pay"],
      });
      expect(tools).toContain("x402_pay");
      expect(tools).not.toContain("x402_batch_pay");
    });

    it("provider default includes quote_job but not set_budget", () => {
      const tools = getArcLayerToolsForRole("provider");
      expect(tools).toContain("erc8183_provider_quote_job");
      expect(tools).not.toContain("erc8183_provider_set_budget");
    });

    it("provider with enableProviderSetBudget=true includes set_budget", () => {
      const tools = getArcLayerToolsForRole("provider", {
        enableProviderSetBudget: true,
      });
      expect(tools).toContain("erc8183_provider_quote_job");
      expect(tools).toContain("erc8183_provider_set_budget");
    });

    it("deniedTools removes set_budget even when enabled", () => {
      const tools = getArcLayerToolsForRole("provider", {
        enableProviderSetBudget: true,
        deniedTools: ["erc8183_provider_set_budget"],
      });
      expect(tools).toContain("erc8183_provider_quote_job");
      expect(tools).not.toContain("erc8183_provider_set_budget");
    });

    it("allowedTools cannot add set_budget unless enableProviderSetBudget=true", () => {
      const tools = getArcLayerToolsForRole("provider", {
        allowedTools: [
          "erc8183_provider_quote_job",
          "erc8183_provider_set_budget",
        ],
      });
      expect(tools).toContain("erc8183_provider_quote_job");
      // set_budget not in role preset and not enabled, so allowedTools intersection removes it
      expect(tools).not.toContain("erc8183_provider_set_budget");
    });

    it("client role cannot access quote_job or set_budget", () => {
      const tools = getArcLayerToolsForRole("client");
      expect(tools).not.toContain("erc8183_provider_quote_job");
      expect(tools).not.toContain("erc8183_provider_set_budget");
    });

    it("evaluator role cannot access quote_job or set_budget", () => {
      const tools = getArcLayerToolsForRole("evaluator");
      expect(tools).not.toContain("erc8183_provider_quote_job");
      expect(tools).not.toContain("erc8183_provider_set_budget");
    });

    it("x402-agent role cannot access quote_job or set_budget", () => {
      const tools = getArcLayerToolsForRole("x402-agent");
      expect(tools).not.toContain("erc8183_provider_quote_job");
      expect(tools).not.toContain("erc8183_provider_set_budget");
    });

    it("read-only role cannot access quote_job or set_budget", () => {
      const tools = getArcLayerToolsForRole("read-only");
      expect(tools).not.toContain("erc8183_provider_quote_job");
      expect(tools).not.toContain("erc8183_provider_set_budget");
    });

    it("deniedTools removes run-and-submit even when explicitly enabled", () => {
      const tools = getArcLayerToolsForRole("provider", {
        enableProviderRunAndSubmit: true,
        deniedTools: ["erc8183_provider_run_and_submit"],
      });
      expect(tools).toContain("erc8183_provider_run_only");
      expect(tools).not.toContain("erc8183_provider_run_and_submit");
      // Read tools still present
      expect(tools).toContain("x402_inspect");
      expect(tools).toContain("payment_receipts");
      expect(tools).toContain("payment_spend_ledger");
    });

    it("allowedTools restricts to intersection with role", () => {
      const tools = getArcLayerToolsForRole("x402-agent", {
        allowedTools: ["x402_inspect", "payment_receipts"],
      });
      expect(tools).toContain("x402_inspect");
      expect(tools).toContain("payment_receipts");
      expect(tools).not.toContain("x402_pay");
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

  describe("source validation", () => {
    it("no raw provider.runtime_* names in langchain adapter source", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const toolMapSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../tool-map.ts"), "utf8"
      );
      const rolesSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../roles.ts"), "utf8"
      );
      const toolsSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../tools.ts"), "utf8"
      );
      // mcpName field in tool-map.ts is OK (internal mapping), but roles.ts and tools.ts must not reference raw names
      expect(rolesSrc).not.toMatch(/provider\.runtime_/);
      expect(rolesSrc).not.toMatch(/provider\.list_/);
      expect(rolesSrc).not.toMatch(/provider\.apply_open_job/);
      expect(rolesSrc).not.toMatch(/provider\.withdraw/);
      expect(rolesSrc).not.toMatch(/provider\.publish_deliverable/);
      expect(rolesSrc).not.toMatch(/erc8183\.provider_run_job/);
      expect(rolesSrc).not.toMatch(/erc8183\.provider_run_and_submit/);
      expect(rolesSrc).not.toMatch(/erc8183\.provider_submit_deliverable/);
      expect(rolesSrc).not.toMatch(/erc8183\.set_budget/);
      expect(rolesSrc).not.toMatch(/jobs\.get_onchain_status/);
      expect(rolesSrc).not.toMatch(/jobs\.get_lifecycle_summary/);
      expect(toolsSrc).not.toMatch(/provider\.runtime_/);
      expect(toolsSrc).not.toMatch(/provider\.list_/);
      expect(toolsSrc).not.toMatch(/provider\.apply_open_job/);
      expect(toolsSrc).not.toMatch(/provider\.withdraw/);
      expect(toolsSrc).not.toMatch(/provider\.publish_deliverable/);
    });

    it("provider role has no raw MCP names in allowedTools", () => {
      const tools = getArcLayerToolsForRole("provider", {
        enableProviderRunAndSubmit: true,
        enableProviderSetBudget: true,
        enableProviderPublishDeliverable: true,
        enableProviderSubmitDeliverable: true,
      });
      for (const t of tools) {
        // Public tool names use protocol-first prefixes, not arclayer_
        expect(t).toMatch(/^(erc8183_|x402_|payment_)/);
        expect(t).not.toMatch(/\./);
      }
    });
  });
});
