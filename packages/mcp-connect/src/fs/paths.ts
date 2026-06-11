import path from 'node:path';
import os from 'node:os';

export const ARCLAYER_PLUGIN_SKILLS = [
  'arclayer-agent-bundle',
  'arclayer-global-agent-commerce',
] as const;

export type ArcLayerPluginSkill = (typeof ARCLAYER_PLUGIN_SKILLS)[number];

export type ConnectPaths = {
  home: string;
  codexConfig: string;
  skillsRoot: string;
  skillDirs: Record<ArcLayerPluginSkill, string>;

  /**
   * Backward-compatible path for the original onboarding skill.
   * Prefer skillsRoot/skillDirs for new code.
   */
  skillDir: string;
  skillFile: string;
};

export function resolvePaths(home = os.homedir()): ConnectPaths {
  const skillsRoot = path.resolve(home, '.arclayer', 'codex-plugin', 'skills');

  const skillDirs = Object.fromEntries(
    ARCLAYER_PLUGIN_SKILLS.map((skill) => [skill, path.join(skillsRoot, skill)]),
  ) as Record<ArcLayerPluginSkill, string>;

  const skillDir = skillDirs['arclayer-agent-bundle'];

  return {
    home,
    codexConfig: path.resolve(home, '.codex', 'config.toml'),
    skillsRoot,
    skillDirs,
    skillDir,
    skillFile: path.join(skillDir, 'SKILL.md'),
  };
}
