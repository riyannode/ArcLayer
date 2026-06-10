# ArcLayer MCP OAuth Connect

ArcLayer's recommended MCP path is a one-command Codex install followed by browser OAuth approval:

```bash
npx @arclayer/mcp-connect@latest codex-plugin
```

## Installer changes

- Reconciles `[mcp_servers.arclayer]` in `~/.codex/config.toml`.
- Configures the ArcLayer protected resource and allowed scopes.
- Uses the Codex keyring OAuth credential store.
- Installs the Agent Bundle Skill at `~/.arclayer/codex-plugin/skills/arclayer-agent-bundle`.
- Adds one `[[skills.config]]` entry for that absolute path.
- Creates `config.toml.bak.<timestamp>` before modifying an existing config.
- Preserves unrelated user configuration and is idempotent.

Run `npx @arclayer/mcp-connect@latest status` to inspect installation state. Run `npx @arclayer/mcp-connect@latest uninstall codex` to remove only ArcLayer MCP and skill entries.

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

## Legacy fallback

If a client does not support OAuth, use `/agent-setup` to create a legacy MCP token. The generated setup command contains the raw token once, legacy sessions last at most 30 days, and active sessions can be revoked in Profile.

## Troubleshooting

- **Codex does not see tools:** restart Codex, run `npx @arclayer/mcp-connect@latest status`, and inspect `~/.codex/config.toml`.
- **OAuth does not open:** reconnect the ArcLayer MCP server in Codex and verify both well-known metadata endpoints.
- **Tool authentication fails:** revoke and reconnect, then verify the granted scope includes the tool's required scope.
- **Transaction request is pending:** open ArcLayer Profile, ensure the matching wallet signing session is active, and approve or reject the request.
