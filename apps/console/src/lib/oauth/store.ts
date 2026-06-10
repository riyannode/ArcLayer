import 'server-only';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
export function oauthDb() { return getSupabaseAdmin(); }
export async function findActiveConnection(clientId: string, ownerWallet: string) {
  const { data } = await oauthDb().from('mcp_oauth_connections').select('*').eq('client_id', clientId).eq('owner_wallet', ownerWallet.toLowerCase()).eq('status', 'active').is('revoked_at', null).maybeSingle(); return data;
}
export async function getActiveConnection(id: string) {
  const { data } = await oauthDb().from('mcp_oauth_connections').select('*').eq('id', id).eq('status', 'active').is('revoked_at', null).maybeSingle(); return data;
}
