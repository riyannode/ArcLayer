import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { sha256Text, RunnerError } from "@arclayer/runner-core";

export function loadGlobalSkill(explicitPath?: string): { content: string; sha256: string; path: string } {
  const candidates = [
    explicitPath,
    path.resolve(process.cwd(), "docs/ARCLAYER_GLOBAL_AGENT_SKILL.md"),
    path.resolve(process.cwd(), "../../docs/ARCLAYER_GLOBAL_AGENT_SKILL.md")
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const content = readFileSync(candidate, "utf8");
      return {
        content,
        sha256: sha256Text(content),
        path: candidate
      };
    }
  }

  throw new RunnerError("GLOBAL_SKILL_MISSING", "docs/ARCLAYER_GLOBAL_AGENT_SKILL.md not found", 500);
}
