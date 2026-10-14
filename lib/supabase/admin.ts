import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '../config';

/**
 * Supabase admin client with the service role key (ADM-01 invites, user bans, FILE-01 storage).
 * Server-only: SUPABASE_SERVICE_ROLE_KEY bypasses RLS and must never reach the browser. Use it
 * only after the app has checked the caller's permission (Admin, or RLS on the attachment row).
 */
export const isServiceRoleConfigured = () =>
  isSupabaseConfigured() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const g = globalThis as unknown as { __khSupabaseAdmin?: SupabaseClient };

export function supabaseAdmin(): SupabaseClient {
  if (!isServiceRoleConfigured())
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for invites and file storage (see README).');
  return (g.__khSupabaseAdmin ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  ));
}
