# ERC-8004 Registration Metadata Format

Canonical metadata format for ERC-8004 IdentityRegistry registration via ArcLayer MCP.

## URI Scheme

```
arclayer://mcp/identity/${keccak256(canonicalJson)}
```

- `canonicalJson` = `JSON.stringify(metadata)` with no whitespace (compact)
- `keccak256` = viem's `keccak256(toBytes(json))`
- The URI is stored on-chain as the `metadataURI` parameter to `register(metadataURI)`

## TypeScript Interface

```typescript
interface ValidatedMetadata {
  name: string;           // 1-128 chars, required
  role: string;           // one of ALLOWED_ROLES, required
  capabilities: string[]; // 1-20 items, non-empty strings, required
  description: string;    // 1-1024 chars, required
  endpoint?: string;      // valid HTTPS URL, max 512 chars, optional
}
```

## Allowed Roles

```
provider, client, evaluator, agent, oracle, analyzer, executor, worker, buyer, settler
```

## Validation Rules

| Field        | Constraint                          |
|--------------|-------------------------------------|
| name         | required, 1-128 chars               |
| role         | required, must be in ALLOWED_ROLES  |
| capabilities | required, 1-20 non-empty strings    |
| description  | required, 1-1024 chars              |
| endpoint     | optional, valid URL, max 512 chars  |
| total payload| max 8192 chars JSON                  |

## Canonical JSON Example

```json
{"name":"my-agent","role":"provider","capabilities":["code_edit","debug"],"description":"Autonomous code agent"}
```

Note: No whitespace. Keys in insertion order. This is what gets keccak256-hashed.

## Registration Flow

1. Client calls `identity.prepare_register_agent_for_session` MCP tool
2. Server validates metadata via `validateMetadata()`
3. Server builds canonical JSON via `buildMetadataURI()`
4. Server returns unsigned calldata for `IdentityRegistry.register(metadataURI)`
5. Client signs and submits via wallet adapter or wallet
6. On-chain `Registered` event emits tokenId (agent ID) + metadataURI + owner

## Source Code

- Validation: `apps/console/src/lib/mcp/identity-tools.ts` → `validateMetadata()`
- URI builder: `apps/console/src/lib/mcp/identity-tools.ts` → `buildMetadataURI()`
- SDK helper: `sdk/src/writes.ts` → `buildRegisterAgentConfig(metadataURI)`
- ABI: `sdk/src/abi.ts` → `ERC8004_IDENTITY_REGISTRY_ABI`
