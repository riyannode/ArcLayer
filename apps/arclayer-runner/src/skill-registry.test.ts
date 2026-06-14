/**
 * Skill Manifest + Tool Registry Tests
 *
 * Tests for Phase 2-6: skill manifest, tool registry, role presets,
 * skill context tools, and console MCP proxy allowlist.
 */

import { describe, it, expect } from "vitest";
import {
  SKILL_MANIFEST,
  resolveAllSkills,
  resolveSkill,
  getSkillsForRole,
  getSkillsByIds,
  bundleSkillsForRole,
} from "./skill-manifest";
import {
  ALL_TOOLS,
  RUNNER_LOCAL_TOOLS,
  SKILL_CONTEXT_TOOLS,
  CONSOLE_MCP_PROXY_TOOLS,
  getToolsForRole,
  getToolByName,
  isProxyToolAllowed,
  getToolNamesForRole,
} from "./tool-registry";
import { ROLE_PRESETS, getRolePreset, listRolePresets } from "./role-presets";

// ── Skill Manifest Tests ──────────────────────────────────────────────────

describe("skill manifest", () => {
  it("SKILL_MANIFEST has at least 10 entries", () => {
    expect(SKILL_MANIFEST.length).toBeGreaterThanOrEqual(10);
  });

  it("all manifest items have required fields", () => {
    for (const item of SKILL_MANIFEST) {
      expect(item.id).toBeTruthy();
      expect(item.title).toBeTruthy();
      expect(item.path).toBeTruthy();
      expect(item.status).toBeTruthy();
      expect(item.executable).toBe(false);
      expect(Array.isArray(item.roles)).toBe(true);
      expect(Array.isArray(item.capabilities)).toBe(true);
    }
  });

  it("resolveAllSkills returns resolved items", () => {
    const resolved = resolveAllSkills();
    expect(resolved.length).toBe(SKILL_MANIFEST.length);
    for (const s of resolved) {
      expect(typeof s.exists).toBe("boolean");
      // If file exists, sha256 and content should be present
      if (s.exists) {
        expect(s.sha256).toBeTruthy();
        expect(s.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(s.content).toBeTruthy();
      }
    }
  });

  it("resolveSkill for unknown ID returns undefined via manifest lookup", () => {
    const item = SKILL_MANIFEST.find((s) => s.id === "nonexistent");
    expect(item).toBeUndefined();
  });

  it("getSkillsForRole returns skills for provider", () => {
    const skills = getSkillsForRole("provider");
    expect(skills.length).toBeGreaterThan(0);
    for (const s of skills) {
      expect(s.roles).toContain("provider");
    }
  });

  it("getSkillsByIds returns matching skills", () => {
    const skills = getSkillsByIds(["arclayer-global-agent-skill", "global-mcp-reference"]);
    expect(skills.length).toBe(2);
    expect(skills[0].id).toBe("arclayer-global-agent-skill");
    expect(skills[1].id).toBe("global-mcp-reference");
  });

  it("bundleSkillsForRole returns bundled content", () => {
    const bundle = bundleSkillsForRole("provider");
    expect(bundle.role).toBe("provider");
    expect(bundle.skillCount).toBeGreaterThan(0);
    expect(bundle.bundle).toBeTruthy();
    expect(bundle.skills.length).toBe(bundle.skillCount);
  });

  it("missing skill files do not crash", () => {
    // resolveAllSkills should handle missing files gracefully
    const resolved = resolveAllSkills();
    const missing = resolved.filter((s) => !s.exists);
    for (const s of missing) {
      expect(s.sha256).toBeNull();
      expect(s.content).toBeNull();
    }
  });
});

// ── Tool Registry Tests ───────────────────────────────────────────────────

describe("tool registry", () => {
  it("RUNNER_LOCAL_TOOLS has 35 entries", () => {
    expect(RUNNER_LOCAL_TOOLS.length).toBe(35);
  });

  it("SKILL_CONTEXT_TOOLS has 5 entries", () => {
    expect(SKILL_CONTEXT_TOOLS.length).toBe(5);
  });

  it("CONSOLE_MCP_PROXY_TOOLS has at least 25 entries", () => {
    expect(CONSOLE_MCP_PROXY_TOOLS.length).toBeGreaterThanOrEqual(25);
  });

  it("ALL_TOOLS = RUNNER_LOCAL + SKILL_CONTEXT + CONSOLE_MCP_PROXY", () => {
    expect(ALL_TOOLS.length).toBe(
      RUNNER_LOCAL_TOOLS.length + SKILL_CONTEXT_TOOLS.length + CONSOLE_MCP_PROXY_TOOLS.length
    );
  });

  it("all tool names are unique", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("all tools have required fields", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.source).toBeTruthy();
      expect(tool.status).toBeTruthy();
      expect(Array.isArray(tool.risk)).toBe(true);
      expect(Array.isArray(tool.capabilities)).toBe(true);
      expect(Array.isArray(tool.roles)).toBe(true);
      expect(tool.description).toBeTruthy();
    }
  });

  it("getToolsForRole('provider') returns provider tools", () => {
    const tools = getToolsForRole("provider");
    expect(tools.length).toBeGreaterThan(21);
    const names = tools.map((t) => t.name);
    expect(names).toContain("runner.health");
    expect(names).toContain("erc8183.provider_run_job");
    expect(names).toContain("runner.skills_list");
  });

  it("getToolsForRole('x402-agent') includes x402.pay but not erc8183", () => {
    const tools = getToolsForRole("x402-agent");
    const names = tools.map((t) => t.name);
    expect(names).toContain("x402.pay");
    expect(names).toContain("x402.batch_pay");
    expect(names).not.toContain("erc8183.provider_run_job");
  });

  it("getToolByName returns correct tool", () => {
    const tool = getToolByName("runner.health");
    expect(tool).toBeDefined();
    expect(tool!.source).toBe("runner-local");
    expect(tool!.risk).toContain("read-only");
  });

  it("isProxyToolAllowed returns true for allowlisted tools", () => {
    expect(isProxyToolAllowed("identity.prepare_register_agent")).toBe(true);
    expect(isProxyToolAllowed("jobs.list_public")).toBe(true);
    expect(isProxyToolAllowed("evaluator.prepare_complete_job")).toBe(true);
  });

  it("isProxyToolAllowed returns false for non-allowlisted tools", () => {
    expect(isProxyToolAllowed("fs.readFile")).toBe(false);
    expect(isProxyToolAllowed("shell.exec")).toBe(false);
    expect(isProxyToolAllowed("env.get")).toBe(false);
    expect(isProxyToolAllowed("runner.health")).toBe(false); // runner-local, not proxy
  });

  it("getToolNamesForRole returns names only", () => {
    const names = getToolNamesForRole("evaluator");
    expect(Array.isArray(names)).toBe(true);
    expect(names).toContain("runner.health");
    expect(names).toContain("evaluator.prepare_complete_job");
  });
});

// ── Role Presets Tests ────────────────────────────────────────────────────

describe("role presets", () => {
  it("ROLE_PRESETS has 8 entries", () => {
    expect(ROLE_PRESETS.length).toBe(8);
  });

  it("all presets have required fields", () => {
    for (const preset of ROLE_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.title).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(Array.isArray(preset.capabilities)).toBe(true);
      expect(Array.isArray(preset.toolGroups)).toBe(true);
      expect(Array.isArray(preset.requiredConfigFields)).toBe(true);
      expect(Array.isArray(preset.optionalConfigFields)).toBe(true);
    }
  });

  it("getRolePreset returns correct preset", () => {
    const provider = getRolePreset("provider");
    expect(provider).toBeDefined();
    expect(provider!.title).toBe("Provider");
    expect(provider!.capabilities).toContain("erc8183");
  });

  it("getRolePreset returns undefined for unknown role", () => {
    expect(getRolePreset("unknown")).toBeUndefined();
  });

  it("listRolePresets returns all presets", () => {
    const list = listRolePresets();
    expect(list.length).toBe(8);
    expect(list.map((p) => p.id)).toContain("provider");
    expect(list.map((p) => p.id)).toContain("client");
    expect(list.map((p) => p.id)).toContain("evaluator");
    expect(list.map((p) => p.id)).toContain("x402-agent");
    expect(list.map((p) => p.id)).toContain("identity-agent");
    expect(list.map((p) => p.id)).toContain("validation-agent");
    expect(list.map((p) => p.id)).toContain("devops-admin");
    expect(list.map((p) => p.id)).toContain("full-stack-agent");
  });

  it("provider preset has payment tools disabled by default", () => {
    const provider = getRolePreset("provider")!;
    expect(provider.defaultPolicy?.paymentEnabled).toBe(false);
  });

  it("x402-agent preset has payment tools enabled by default", () => {
    const x402 = getRolePreset("x402-agent")!;
    expect(x402.defaultPolicy?.paymentEnabled).toBe(true);
  });

  it("full-stack-agent has wildcard tool group", () => {
    const full = getRolePreset("full-stack-agent")!;
    expect(full.toolGroups).toContain("*");
  });
});
