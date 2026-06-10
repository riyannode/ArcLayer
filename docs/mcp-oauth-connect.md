# ArcLayer MCP OAuth Connect

### Recommended: OAuth Codex installer
This installs ArcLayer MCP configuration and the Agent Bundle Skill for Codex. The connector uses OAuth. It can request wallet actions, but signing remains browser-mediated.

```bash


For local development from this repository:
```bash
git clone https://github.com/riyannode/ArcLayer
cd ArcLayer
pnpm install

node packages/mcp-connect/dist/index.js codex-plugin
```

After npm publish:
```bash
npx arclayer-codex@latest
```
```

## Installer changes

- Reconciles `[mcp_servers.arclayer]` in `~/.codex/config.toml`.
- Configures the ArcLayer protected resource and allowed scopes.
- Uses the Codex keyring OAuth credential store.
- Installs the Agent Bundle Skill at `~/.arclayer/codex-plugin/skills/arclayer-agent-bundle`.
- Adds one `[[skills.config]]` entry for that absolute path.
- Creates `config.toml.bak.<timestamp>` before modifying an existing config.
- Preserves unrelated user configuration and is idempotent.

Run `node packages/mcp-connect/dist/index.js status` to inspect installation state. Run `npx arclayer-codex@latest uninstall codex` to remove only ArcLayer MCP and skill entries.

## OAuth flow

1. The MCP client discovers `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`.
2. A public local client dynamically registers HTTPS or loopback redirect URIs.
3. Authorization uses code flow with PKCE S256 and the exact ArcLayer MCP resource.
4. The user establishes an ArcLayer wallet session and reviews requested scopes.
5. ArcLayer stores only a hash of the short-lived authorization code.
6. The token endpoint consumes the code once and returns raw access and refresh tokens once.
7. ArcLayer stores only token hashes. Access tokens expire after one hour; refresh tokens expire after 30 days and rotate on use.
8. Revocation invalidates access or refresh tokens without revealing whether a token existed.

The database schema is `supabase/migrations/20250305000000_mcp_oauth.sql`. This repository change does **not** run it. Review and apply it manually when deploying:

```bash
supabase migration up --linked
```

## Wallet signing boundary

OAuth lets a client call approved ArcLayer MCP tools. It never grants private-key access and cannot directly sign or broadcast an onchain transaction. Transaction tools create signing requests bound to the OAuth owner wallet and connection metadata. The user must open ArcLayer web and approve or reject each request with the wallet; the client only polls request status.

### Advanced: legacy token fallback

Legacy token/session setup remains available for older MCP clients or debugging, but it is no longer the recommended setup path. Use `/agent-setup` to create a 30-day legacy token.

## Troubleshooting

- **Codex does not see tools:** restart Codex, run `npx arclayer-codex@latest status`, and inspect `~/.codex/config.toml`.
- **OAuth does not open:** reconnect the ArcLayer MCP server in Codex and verify both well-known metadata endpoints.
- **Tool authentication fails:** revoke and reconnect, then verify the granted scope includes the tool's required scope.
- **Transaction request is pending:** open ArcLayer Profile, ensure the matching wallet signing session is active, and approve or reject the request.
