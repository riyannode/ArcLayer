import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arclayerMcpToml, arclayerSkillToml, arclayerSkillsToml } from '../config/codex-config.js';
import { reconcileCodexConfig, uninstallArcLayerConfig } from '../config/toml.js';
import { resolvePaths } from '../fs/paths.js';
import { readText, safeWrite } from '../fs/safe-write.js';

export type InstallOptions = { home?: string; withSkill?: boolean; templateFile?: string };

function bundledSkillsRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const rel = ['skills'];

  const candidates = [
    path.resolve(here, '..', 'plugin', ...rel),
    path.resolve(here, '..', '..', 'plugin', ...rel),
    path.resolve(process.cwd(), 'plugin', ...rel),
    path.resolve(process.cwd(), 'packages', 'mcp-connect', 'plugin', ...rel),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));

  if (!found) {
    throw new Error(`ArcLayer Codex skills root not found. Checked: ${candidates.join(', ')}`);
  }

  return found;
}

function bundledTemplate(): string {
  const skillPath = path.join(bundledSkillsRoot(), 'arclayer-agent-bundle', 'SKILL.md');

  if (!existsSync(skillPath)) {
    throw new Error(`ArcLayer Agent Bundle skill template not found: ${skillPath}`);
  }

  return skillPath;
}

async function copyBundledSkills(sourceRoot: string, targetRoot: string): Promise<string[]> {
  await mkdir(targetRoot, { recursive: true });

  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const installedSkillPaths: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);

    await cp(source, target, { recursive: true, force: true });
    installedSkillPaths.push(target);
  }

  return installedSkillPaths.sort();
}

export async function installCodex(options: InstallOptions = {}) {
  const paths = resolvePaths(options.home);
  let skillBlock: string | undefined;
  let skillRemovalPaths: string | string[] | undefined;

  if (options.withSkill) {
    if (options.templateFile) {
      await mkdir(paths.skillDir, { recursive: true });
      await copyFile(options.templateFile ?? bundledTemplate(), paths.skillFile);
      skillBlock = arclayerSkillToml(paths.skillDir);
      skillRemovalPaths = paths.skillDir;
    } else {
      const installedSkillPaths = await copyBundledSkills(bundledSkillsRoot(), paths.skillsRoot);
      skillBlock = arclayerSkillsToml(installedSkillPaths);
      skillRemovalPaths = installedSkillPaths;
    }
  }

  const current = await readText(paths.codexConfig);
  const content = reconcileCodexConfig(current, arclayerMcpToml(), skillBlock, skillRemovalPaths);
  const backup = await safeWrite(paths.codexConfig, content);

  return { paths, backup, changed: current !== content };
}

export async function uninstallCodex(home?: string) {
  const paths = resolvePaths(home);
  const current = await readText(paths.codexConfig);
  const allSkillPaths = Object.values(paths.skillDirs);
  const content = uninstallArcLayerConfig(current, allSkillPaths);
  const backup = await safeWrite(paths.codexConfig, content);

  return { paths, backup, changed: current !== content };
}
