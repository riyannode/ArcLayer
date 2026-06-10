import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { arclayerMcpToml } from './config/codex-config.js';
import { backupPath } from './fs/backup.js';
import { resolvePaths } from './fs/paths.js';
import { installCodex, uninstallCodex } from './plugin/install-codex-plugin.js';

const template = path.resolve(process.cwd(), 'templates/codex/skills/arclayer-agent-bundle/SKILL.md');
describe('ArcLayer MCP Connect', () => {
  it('generates OAuth-ready config without legacy bearer env configuration', () => {
    const toml = arclayerMcpToml();
    expect(toml).toContain('oauth_resource = "https://arclayers.xyz/api/mcp"');
    expect(toml).toContain('onboarding.start_agent_bundle');
    expect(toml).not.toContain('bearer_token_env_var');
  });
  it('installs idempotently, replaces stale ArcLayer config, and preserves unrelated config', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'arclayer-connect-'));
    const paths = resolvePaths(home); await mkdir(path.dirname(paths.codexConfig), { recursive: true });
    await writeFile(paths.codexConfig, 'model = "gpt"\n\n[mcp_servers.arclayer]\nurl = "https://stale"\n\n[[skills.config]]\npath = "/tmp/other"\nenabled = true\n');
    await installCodex({ home, withSkill: true, templateFile: template });
    const once = await readFile(paths.codexConfig, 'utf8');
    await installCodex({ home, withSkill: true, templateFile: template });
    const twice = await readFile(paths.codexConfig, 'utf8');
    expect(twice).toBe(once); expect(twice).toContain('model = "gpt"'); expect(twice).not.toContain('https://stale');
    expect(twice.match(/\[mcp_servers\.arclayer\]/g)).toHaveLength(1);
    expect(twice.match(/\.arclayer\/codex-plugin\/skills\/arclayer-agent-bundle/g)).toHaveLength(1);
    expect(await readFile(paths.skillFile, 'utf8')).toContain('Never ask for private keys');
  });
  it('uninstalls only ArcLayer entries', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'arclayer-connect-')); const paths = resolvePaths(home);
    await installCodex({ home, withSkill: true, templateFile: template });
    await writeFile(paths.codexConfig, (await readFile(paths.codexConfig, 'utf8')) + '\n[other]\nvalue = true\n');
    await uninstallCodex(home); const result = await readFile(paths.codexConfig, 'utf8');
    expect(result).not.toContain('[mcp_servers.arclayer]'); expect(result).not.toContain(paths.skillDir); expect(result).toContain('[other]');
  });
  it('creates timestamped backup paths and resolves platform-safe absolute paths', () => {
    expect(backupPath('/tmp/config', new Date('2026-01-02T03:04:05.000Z'))).toBe('/tmp/config.bak.2026-01-02T03-04-05-000Z');
    expect(path.isAbsolute(resolvePaths('/tmp/home').skillDir)).toBe(true);
  });
});
