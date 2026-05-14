/**
 * Supabase admin client — server-only.
 * Uses service_role key which bypasses RLS.
 * NEVER import this from client components or pages with 'use client'.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) throw new Error('[x402] NEXT_PUBLIC_SUPABASE_URL is not set');
if (!serviceKey) throw new Error('[x402] SUPABASE_SERVICE_ROLE_KEY is not set');

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
