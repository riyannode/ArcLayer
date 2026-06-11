# ArcLayer Legacy Tool Audit

Generated: 2026-06-12
Purpose: Classify legacy/advanced tools and plan deprecation timeline.

---

## Classification Legend

| Category | Description |
|----------|-------------|
| `KEEP_ACTIVE` | Currently used, do not deprecate |
| `KEEP_LEGACY_ADVANCED` | Old path, kept for advanced users |
| `DEPRECATE_LATER` | Will be deprecated after UI migration complete |
| `REMOVE_AFTER_UI_MIGRATION` | Remove after all UI references updated |
| `REMOVE_AFTER_NO_IMPORTS` | Remove after confirming no imports remain |
| `UNKNOWN_REVIEW` | Needs manual review |

---

## Audit Results

### 1. arclayer-codex (packages/mcp-connect)

| Item | Status | Reason |
|------|--------|--------|
| `packages/mcp-connect/src/` | `KEEP_ACTIVE` | Core MCP connect library |
| `packages/mcp-connect/plugin/` | `KEEP_ACTIVE` | Skills and plugin system |
| `packages/mcp-connect/arclayer-codex-0.1.0.tgz` | `KEEP_ACTIVE` | UI still uses `npx arclayer-codex@latest` |
| `packages/mcp-connect/arclayer-mcp-connect-0.1.0.tgz` | `KEEP_ACTIVE` | Codex depends on it |
| `packages/mcp-connect/src/clients/codex.ts` | `KEEP_ACTIVE` | Codex client |
| `packages/mcp-connect/src/config/codex-config.ts` | `KEEP_ACTIVE` | Codex config |
| `packages/mcp-connect/src/plugin/install-codex-plugin.ts` | `KEEP_ACTIVE` | Codex plugin installer |

**Rule:** Do not deprecate arclayer-codex while UI still uses `npx arclayer-codex@latest`.

### 2. Legacy Install Scripts

| Item | Status | Reason |
|------|--------|--------|
| `apps/console/public/install/erc8183-bot.sh` | `DEPRECATE_LATER` | Replaced by `npx -y @arclayer/setup@next`. Already marked LEGACY in script header. Keep until no UI/docs reference. |
| `apps/console/public/install/erc8183-provider.sh` | `DEPRECATE_LATER` | Same as above |
| `apps/console/public/install/erc8183-evaluator.sh` | `DEPRECATE_LATER` | Same as above |

**Rule:** Do not delete old curl scripts until no UI/docs/tests reference them.

### 3. External PM2 Bots

| Item | Status | Reason |
|------|--------|--------|
| `examples/external-pm2-bots/` | `KEEP_LEGACY_ADVANCED` | PM2 deployment path for advanced users |
| `examples/external-pm2-bots/provider-runtime-bot/` | `KEEP_LEGACY_ADVANCED` | Provider runtime example |
| `examples/external-pm2-bots/evaluator-runtime-bot/` | `KEEP_LEGACY_ADVANCED` | Evaluator runtime example |
| `examples/external-pm2-bots/market-agent-bridge/` | `KEEP_LEGACY_ADVANCED` | Market agent bridge example |

**Rule:** PM2 provider bot can remain legacy/advanced. New recommended path is Runner MCP STDIO.

### 4. buildInstallCommand.ts

| Item | Status | Reason |
|------|--------|--------|
| `apps/console/src/lib/external-bot/buildInstallCommand.ts` | `KEEP_ACTIVE` | Updated to use `npx -y @arclayer/setup@next` |
| Old curl path in buildInstallCommand | `REMOVE_AFTER_UI_MIGRATION` | Already replaced with setup@next command |

### 5. Legacy ERC-8183 Examples

| Item | Status | Reason |
|------|--------|--------|
| `examples/external-erc8183-bots/` | `UNKNOWN_REVIEW` | Legacy ERC-8183 examples. Check if still referenced. |

### 6. Legacy Docs

| Item | Status | Reason |
|------|--------|--------|
| `docs/ARCLAYER_INTEGRATION_SKILL.md` | `KEEP_ACTIVE` | Still valid, points to GLOBAL_AGENT_SKILL |
| `docs/AUTONOMOUS_AGENT_BUSINESS_LOOP_SKILL.md` | `KEEP_ACTIVE` | Still valid, points to GLOBAL_AGENT_SKILL |

---

## Import/Usage Check

Search for references to legacy items before marking removable:

```
rg "arclayer-codex|arclayer-mcp-connect|erc8183-bot.sh|erc8183-provider.sh|external-pm2-bots|External PM2|buildInstallCommand|curl -fsSL"
```

### Results:
- `arclayer-codex`: Referenced in UI (`agent-setup/page.tsx`), README, packages/mcp-connect → `KEEP_ACTIVE`
- `arclayer-mcp-connect`: Referenced by arclayer-codex → `KEEP_ACTIVE`
- `erc8183-bot.sh`: Referenced in `buildInstallCommand.ts` (now legacy), smoke tests → `DEPRECATE_LATER`
- `erc8183-provider.sh`: Referenced in `buildInstallCommand.ts` (now legacy) → `DEPRECATE_LATER`
- `external-pm2-bots`: Referenced in README, docs → `KEEP_LEGACY_ADVANCED`
- `buildInstallCommand.ts`: Active in console app → `KEEP_ACTIVE`
- `curl -fsSL`: Only in legacy scripts → `DEPRECATE_LATER`

---

## Deprecation Timeline

| Phase | Action | Blocked By |
|-------|--------|------------|
| Now | Mark legacy scripts with `⚠️ LEGACY` banner | Done ✅ |
| Now | Update buildInstallCommand to use setup@next | Done ✅ |
| After stable 0.1.2 | Add deprecation notice to erc8183-bot.sh in UI | UI migration |
| After UI migration | Remove curl scripts from public/install/ | No UI references |
| After no imports | Remove examples/external-pm2-bots/ | No docs references |
| Never | Remove arclayer-codex while UI uses it | UI still uses it |

---

## New Recommended Path

```
npx -y @arclayer/setup@next
```

This replaces:
- `curl -fsSL https://arclayers.xyz/install/erc8183-bot.sh | bash`
- `curl -fsSL https://arclayers.xyz/install/erc8183-provider.sh | bash`
- Manual PM2 setup
- Manual .env configuration
