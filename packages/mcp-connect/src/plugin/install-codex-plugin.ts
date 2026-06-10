import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arclayerMcpToml, arclayerSkillToml } from '../config/codex-config.js';
import { reconcileCodexConfig, uninstallArcLayerConfig } from '../config/toml.js';
import { resolvePaths } from '../fs/paths.js';
import { readText, safeWrite } from '../fs/safe-write.js';

export type InstallOptions = { home?: string; withSkill?: boolean; templateFile?: string };
function bundledTemplate(): string { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'codex', 'skills', 'arclayer-agent-bundle', 'SKILL.md'); }
export async function installCodex(options: InstallOptions = {}) {
  const paths = resolvePaths(options.home);
  if (options.withSkill) {
    await mkdir(paths.skillDir, { recursive: true });
    await copyFile(options.templateFile ?? bundledTemplate(), paths.skillFile);
  }
  const current = await readText(paths.codexConfig);
  const content = reconcileCodexConfig(current, arclayerMcpToml(), options.withSkill ? arclayerSkillToml(paths.skillDir) : undefined, paths.skillDir);
  const backup = await safeWrite(paths.codexConfig, content);
  return { paths, backup, changed: current !== content };
}
export async function uninstallCodex(home?: string) {
  const paths = resolvePaths(home);
  const current = await readText(paths.codexConfig);
  const content = uninstallArcLayerConfig(current, paths.skillDir);
  const backup = await safeWrite(paths.codexConfig, content);
  return { paths, backup, changed: current !== content };
}
