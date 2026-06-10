import 'server-only';
import { randomUUID } from 'node:crypto';
import { oauthDb } from './store';
export async function registerOAuthClient(input: { clientName: string; redirectUris: string[]; grantTypes: string[]; responseTypes: string[]; tokenEndpointAuthMethod: string }) {
  const clientId = `arc_client_${randomUUID()}`;
  const row = { client_id: clientId, client_name: input.clientName, redirect_uris: input.redirectUris, grant_types: input.grantTypes, response_types: input.responseTypes, token_endpoint_auth_method: input.tokenEndpointAuthMethod };
  const { data, error } = await oauthDb().from('oauth_clients').insert(row).select('*').single(); if (error || !data) throw new Error('oauth_client_registration_failed'); return data;
}
export async function getOAuthClient(clientId: string) { const { data } = await oauthDb().from('oauth_clients').select('*').eq('client_id', clientId).is('revoked_at', null).maybeSingle(); return data; }
