import path from 'node:path';
import os from 'node:os';
export type ConnectPaths = { home: string; codexConfig: string; skillDir: string; skillFile: string };
export function resolvePaths(home = os.homedir()): ConnectPaths {
  const skillDir = path.resolve(home, '.arclayer', 'codex-plugin', 'skills', 'arclayer-agent-bundle');
  return { home, codexConfig: path.resolve(home, '.codex', 'config.toml'), skillDir, skillFile: path.join(skillDir, 'SKILL.md') };
}
