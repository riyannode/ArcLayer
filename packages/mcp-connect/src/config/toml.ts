const MCP_HEADER = '[mcp_servers.arclayer]';
const SKILL_HEADER = '[[skills.config]]';

function sectionEnd(lines: string[], start: number): number {
  for (let i = start + 1; i < lines.length; i++) if (/^\s*\[/.test(lines[i])) return i;
  return lines.length;
}

function removeSections(input: string, matches: (lines: string[], start: number, end: number) => boolean): string {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];

  for (let i = 0; i < lines.length;) {
    if (/^\s*\[/.test(lines[i])) {
      const end = sectionEnd(lines, i);
      if (matches(lines, i, end)) {
        i = end;
        continue;
      }
    }

    kept.push(lines[i++]);
  }

  return kept.join('\n').trim();
}

export function removeArcLayerMcp(input: string): string {
  return removeSections(input, (lines, start) => lines[start].trim() === MCP_HEADER);
}

export function removeArcLayerSkill(input: string, skillPath?: string): string {
  return removeSections(input, (lines, start, end) => {
    if (lines[start].trim() !== SKILL_HEADER) return false;

    const block = lines.slice(start, end).join('\n');

    return (
      (skillPath ? block.includes(JSON.stringify(skillPath)) || block.includes(skillPath) : false) ||
      block.includes('.arclayer/codex-plugin/skills/arclayer-agent-bundle') ||
      block.includes('.arclayer/codex-plugin/skills/arclayer-global-agent-commerce') ||
      block.includes('.arclayer/codex-plugin/skills')
    );
  });
}

function ensureCredentialStore(input: string): string {
  const without = input
    .split(/\r?\n/)
    .filter((line) => !/^\s*mcp_oauth_credentials_store\s*=/.test(line))
    .join('\n')
    .trim();

  return `mcp_oauth_credentials_store = "keyring"${without ? `\n\n${without}` : ''}`;
}

export function reconcileCodexConfig(input: string, mcpBlock: string, skillBlock?: string, skillPath?: string): string {
  let output = removeArcLayerMcp(input);
  output = removeArcLayerSkill(output, skillPath);
  output = ensureCredentialStore(output);

  return [output, mcpBlock, skillBlock].filter(Boolean).join('\n\n').trim() + '\n';
}

export function uninstallArcLayerConfig(input: string, skillPath?: string): string {
  return removeArcLayerSkill(removeArcLayerMcp(input), skillPath).trim() + '\n';
}
