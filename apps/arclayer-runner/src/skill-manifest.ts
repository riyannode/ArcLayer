/**
 * ArcLayer Runner Skill Manifest
 *
 * Declares all safe skill/context files that can be loaded by Runner MCP.
 * Skills are CONTEXT ONLY — never executed as code.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

// ── Types ─────────────────────────────────────────────────────────────────

export type RunnerRole =
  | "provider"
  | "client"
  | "evaluator"
  | "x402-agent"
  | "identity-agent"
  | "validation-agent"
  | "devops-admin"
  | "full-stack-agent";

export type SkillStatus = "active" | "legacy" | "deprecated" | "dev-only";

export type RunnerSkillManifestItem = {
  id: string;
  title: string;
  path: string;
  status: SkillStatus;
  exposeAsContext: boolean;
  executable: false;
  roles: RunnerRole[];
  capabilities: string[];
  notes?: string;
};

export type RunnerSkillResolved = RunnerSkillManifestItem & {
  exists: boolean;
  sha256: string | null;
  content: string | null;
};

// ── Base paths ─────────────────────────────────────────────────────────────

function repoRoot(): string {
  // From apps/arclayer-runner/src/ → repo root is ../../
  return resolve(import.meta.dirname ?? __dirname, "../../..");
}

function resolveSkillPath(relativePath: string): string {
  return join(repoRoot(), relativePath);
}

// ── Manifest ───────────────────────────────────────────────────────────────

export const SKILL_MANIFEST: RunnerSkillManifestItem[] = [
  {
    id: "arclayer-global-agent-skill",
    title: "ArcLayer Global Agent Skill",
    path: "docs/ARCLAYER_GLOBAL_AGENT_SKILL.md",
    status: "active",
    exposeAsContext: true,
    executable: false,
    roles: ["provider", "client", "evaluator", "x402-agent", "identity-agent", "validation-agent", "devops-admin", "full-stack-agent"],
    capabilities: ["erc8004", "erc8183", "x402", "mcp", "circle", "receipts", "proof"],
  },
  {
    id: "autonomous-agent-business-loop",
    title: "Autonomous Agent Business Loop",
    path: "docs/AUTONOMOUS_AGENT_BUSINESS_LOOP_SKILL.md",
    status: "active",
    exposeAsContext: true,
    executable: false,
    roles: ["provider", "client", "full-stack-agent"],
    capabilities: ["business-loop", "autonomous", "revenue"],
  },
  {
    id: "arclayer-integration-skill",
    title: "ArcLayer Integration Skill",
    path: "docs/ARCLAYER_INTEGRATION_SKILL.md",
    status: "active",
    exposeAsContext: true,
    executable: false,
    roles: ["provider", "client", "evaluator", "x402-agent", "identity-agent", "devops-admin", "full-stack-agent"],
    capabilities: ["integration", "setup", "mcp"],
  },
  {
    id: "global-mcp-reference",
    title: "Global MCP Tool Reference",
    path: "docs/global-mcp.md",
    status: "active",
    exposeAsContext: true,
    executable: false,
    roles: ["provider", "client", "evaluator", "x402-agent", "identity-agent", "validation-agent", "devops-admin", "full-stack-agent"],
    capabilities: ["mcp", "tools", "reference"],
  },
  {
    id: "agents-md",
    title: "Repository Operating Guide (AGENTS.md)",
    path: "AGENTS.md",
    status: "active",
    exposeAsContext: true,
    executable: false,
    roles: ["devops-admin", "full-stack-agent"],
    capabilities: ["architecture", "conventions", "repo-structure"],
  },
  {
    id: "arclayer-global-agent-commerce-plugin",
    title: "ArcLayer Global Agent Commerce Plugin Skill",
    path: "packages/mcp-connect/plugin/skills/arclayer-global-agent-commerce/SKILL.md",
    status: "active",
    exposeAsContext: true,
    executable: false,
    roles: ["provider", "client", "evaluator", "x402-agent", "identity-agent"],
    capabilities: ["erc8004", "erc8183", "x402", "commerce"],
  },
  {
    id: "arclayer-agent-bundle-plugin",
    title: "ArcLayer Agent Bundle Plugin Skill",
    path: "packages/mcp-connect/plugin/skills/arclayer-agent-bundle/SKILL.md",
    status: "active",
    exposeAsContext: true,
    executable: false,
    roles: ["provider", "client", "evaluator", "identity-agent"],
    capabilities: ["agent-bundle", "onboarding"],
  },
  {
    id: "mcp-erc8004-identity-tools",
    title: "ERC-8004 Identity MCP Tools Reference",
    path: "docs/mcp-erc8004-identity-tools.md",
    status: "active",
    exposeAsContext: true,
    executable: false,
    roles: ["identity-agent", "provider"],
    capabilities: ["erc8004", "identity", "registration"],
  },
  {
    id: "x402-payment-flow",
    title: "x402 Payment Flow",
    path: "docs/x402-payment-flow.md",
    status: "active",
    exposeAsContext: true,
    executable: false,
    roles: ["x402-agent", "provider", "client"],
    capabilities: ["x402", "payment", "micropayment"],
  },
  {
    id: "x402-agent-payer-binding",
    title: "x402 Agent Payer Binding",
    path: "docs/x402-agent-payer-binding.md",
    status: "active",
    exposeAsContext: true,
    executable: false,
    roles: ["x402-agent"],
    capabilities: ["x402", "payer-binding", "security"],
  },
  {
    id: "provider-runtime-memory",
    title: "Provider Runtime Memory",
    path: "docs/provider-runtime-memory.md",
    status: "active",
    exposeAsContext: true,
    executable: false,
    roles: ["provider"],
    capabilities: ["runtime", "memory", "provider"],
  },
];

// ── Resolve helpers ────────────────────────────────────────────────────────

/**
 * Resolve a single skill manifest item to include file content + sha256.
 */
export function resolveSkill(item: RunnerSkillManifestItem): RunnerSkillResolved {
  const fullPath = resolveSkillPath(item.path);
  const exists = existsSync(fullPath);

  if (!exists) {
    return { ...item, exists: false, sha256: null, content: null };
  }

  try {
    const content = readFileSync(fullPath, "utf8");
    const sha256 = createHash("sha256").update(content).digest("hex");
    return { ...item, exists: true, sha256, content };
  } catch {
    return { ...item, exists: false, sha256: null, content: null };
  }
}

/**
 * Resolve all manifest items.
 */
export function resolveAllSkills(): RunnerSkillResolved[] {
  return SKILL_MANIFEST.map(resolveSkill);
}

/**
 * Get skills for a specific role.
 */
export function getSkillsForRole(role: RunnerRole): RunnerSkillResolved[] {
  return SKILL_MANIFEST
    .filter((item) => item.roles.includes(role))
    .map(resolveSkill);
}

/**
 * Get skills by IDs.
 */
export function getSkillsByIds(ids: string[]): RunnerSkillResolved[] {
  return SKILL_MANIFEST
    .filter((item) => ids.includes(item.id))
    .map(resolveSkill);
}

/**
 * Bundle skill context for a role (concatenated content with headers).
 */
export function bundleSkillsForRole(role: RunnerRole): {
  role: string;
  skillCount: number;
  bundle: string;
  skills: Array<{ id: string; sha256: string; exists: boolean }>;
} {
  const skills = getSkillsForRole(role).filter((s) => s.exists && s.exposeAsContext);
  const parts: string[] = [];
  const meta: Array<{ id: string; sha256: string; exists: boolean }> = [];

  for (const skill of skills) {
    parts.push(`# ── ${skill.title} ──────────────────────────────────\n# Source: ${skill.path}\n# SHA256: ${skill.sha256}\n\n${skill.content}`);
    meta.push({ id: skill.id, sha256: skill.sha256 ?? "", exists: true });
  }

  return {
    role,
    skillCount: skills.length,
    bundle: parts.join("\n\n---\n\n"),
    skills: meta,
  };
}
