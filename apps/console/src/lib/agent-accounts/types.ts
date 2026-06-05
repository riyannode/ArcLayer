/**
 * MCP Session + Agent Account — Types.
 *
 * Agent accounts bind an owner wallet (user/passkey) to a Circle Smart Account
 * (the agent account / controller). MCP sessions authenticate Claude/Codex
 * callers against ArcLayer's MCP tools with scoped permissions.
 */

// ── Agent Account ──────────────────────────────────────────────────────────

export interface AgentAccount {
  id: string;
  ownerAddress: string;
  agentAccountAddress: string;
  walletProvider: string;
  accountType: string;
  chainId: number;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAgentAccountParams {
  ownerAddress: string;
  agentAccountAddress: string;
  walletProvider?: string;
  accountType?: string;
  chainId?: number;
}

// ── MCP Session ────────────────────────────────────────────────────────────

export interface McpSessionPermissions {
  allowedContracts?: string[];
  allowedActions?: string[];
  [key: string]: unknown;
}

export interface McpSession {
  id: string;
  tokenHash: string;
  ownerAddress: string;
  agentAccountAddress: string;
  permissions: McpSessionPermissions;
  autoApprove: boolean;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /** Computed: 'active' | 'expired' | 'revoked'. Not stored in DB. */
  status: 'active' | 'expired' | 'revoked';
}

export interface CreateMcpSessionParams {
  ownerAddress: string;
  agentAccountAddress: string;
  permissions?: McpSessionPermissions;
  autoApprove?: boolean;
  expiresInMs?: number;
}

export interface McpSessionCreated {
  session: McpSession;
  /** Raw token — returned once, never stored. Caller must save it. */
  token: string;
}
