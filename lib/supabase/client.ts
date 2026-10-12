import { createBrowserClient } from '@supabase/ssr';

/** Supabase client for the auth pages in the browser. Only valid when Supabase is configured. */
export const createSupabaseBrowserClient = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
