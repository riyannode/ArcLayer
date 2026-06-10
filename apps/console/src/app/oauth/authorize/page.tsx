import { getOAuthClient } from '@/lib/oauth/clients';
import { MCP_OAUTH_RESOURCE, parseScopes } from '@/lib/oauth/scopes';
import { OAuthConsentClient } from './OAuthConsentClient';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
type Params = Record<string,string|string[]|undefined>;
function one(value: string|string[]|undefined) { return typeof value === 'string' ? value : ''; }
export default async function OAuthAuthorizePage({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams; const params = Object.fromEntries(['client_id','redirect_uri','response_type','scope','state','code_challenge','code_challenge_method','resource'].map((k) => [k, one(raw[k])])) as Record<string,string>;
  const client = await getOAuthClient(params.client_id); const scopes = parseScopes(params.scope);
  const valid = !!client && (client.redirect_uris as string[]).includes(params.redirect_uri) && params.response_type === 'code' && !!params.code_challenge && params.code_challenge_method === 'S256' && params.resource === MCP_OAUTH_RESOURCE && !!scopes;
  if (!valid) return <main className="mx-auto max-w-xl px-6 py-20 text-white"><h1 className="text-2xl font-semibold">Invalid OAuth request</h1><p className="mt-3 text-white/60">The client, redirect URI, PKCE challenge, resource, or requested scopes are invalid.</p></main>;
  return <OAuthConsentClient clientName={client.client_name} params={params} scopes={scopes} />;
}
