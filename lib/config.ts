/** Single source of truth for the product name. Rename here only. */
export const APP_NAME = 'Konnect Hub';
export const COMPANY_NAME = 'Konnector LLC';
export const SENDING_DOMAIN = 'konnectortech.com';

/** Demo mode runs on the in-memory store when Supabase is not configured. */
export const isSupabaseConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
