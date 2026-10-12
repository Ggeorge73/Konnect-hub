import { ORGS, PROFILES } from './seed';

/**
 * Fixed uuids used by supabase/seed.sql, keyed by the legacy ids of the in-memory seed
 * (lib/data/seed.ts). Profiles are b0000000-…-0000000000NN in PROFILES order, orgs
 * a0000000-…-00000000000N in ORGS order and projects c0000000-…-00000000000N.
 */
const uuid = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const SEED_PROFILE_UUID: Record<string, string> = Object.fromEntries(
  PROFILES.map((p, i) => [p.id, uuid('b', i + 1)]),
);
export const SEED_ORG_UUID: Record<string, string> = Object.fromEntries(
  ORGS.map((o, i) => [o.id, uuid('a', i + 1)]),
);
export const SEED_PROJECT_UUID: Record<string, string> = {
  p_ehr: uuid('c', 1),
  p_rvb: uuid('c', 2),
  p_psr: uuid('c', 3),
};

/** Maps a demo persona id (u_lead) to its seed uuid; uuids pass through unchanged. */
export const seedUserUuid = (id: string) => SEED_PROFILE_UUID[id] ?? id;
