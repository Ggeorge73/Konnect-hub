import type { Repo } from './repo';
import { memoryRepo } from './memory';

/**
 * Returns the active repository. The Supabase adapter (lib/data/supabase.ts) is selected
 * when Supabase env vars are present; otherwise the seeded in-memory demo store is used.
 */
export function getRepo(): Repo {
  return memoryRepo;
}
export type * from './repo';
