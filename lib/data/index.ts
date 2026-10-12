import type { Repo } from './repo';
import { memoryRepo } from './memory';
import { postgresRepo } from './postgres';
import { isSupabaseConfigured } from '../config';

/**
 * Postgres + RLS (lib/data/postgres.ts) when DATABASE_URL is set and either KH_DATA=postgres
 * or Supabase is configured. Otherwise the seeded in-memory demo store.
 */
export const isPostgresEnabled = () =>
  Boolean(process.env.DATABASE_URL) && (process.env.KH_DATA === 'postgres' || isSupabaseConfigured());

/** Returns the active repository. */
export function getRepo(): Repo {
  return isPostgresEnabled() ? postgresRepo() : memoryRepo;
}
export type * from './repo';
