import { access } from 'node:fs/promises';
import path from 'node:path';
import { arclayerMcpToml } from '../config/codex-config.js';
import { type ArcLayerPluginSkill, ARCLAYER_PLUGIN_SKILLS, resolvePaths } from '../fs/paths.js';
import { readText } from '../fs/safe-write.js';

export type SkillStatus = { path: string; exists: boolean; configured: boolean };

export async function codexStatus(home?: string) {
  const paths = resolvePaths(home);
  const config = await readText(paths.codexConfig);

  const skills: Record<ArcLayerPluginSkill, SkillStatus> = {} as Record<ArcLayerPluginSkill, SkillStatus>;
  let allSkillsInstalled = true;

  for (const skill of ARCLAYER_PLUGIN_SKILLS) {
    const skillPath = paths.skillDirs[skill];
    const skillFile = path.join(skillPath, 'SKILL.md');
    let exists = true;
    try { await access(skillFile); } catch { exists = false; }
    const configured = config.includes(skill);
    skills[skill] = { path: skillPath, exists, configured };
    if (!exists) allSkillsInstalled = false;
  }

  // Backward compat: skillExists is true only if ALL skills are installed
  const skillExists = allSkillsInstalled;

  return {
    paths,
    configExists: !!config,
    mcpConfigured: config.includes('[mcp_servers.arclayer]'),
    oauthReady: config.includes('oauth_resource') && config.includes('mcp_oauth_credentials_store = "keyring"'),
    skillExists,
    skills,
    allSkillsInstalled,
    expectedMcp: arclayerMcpToml(),
  };
}
