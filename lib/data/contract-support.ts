import { beforeEach } from 'vitest';
import type { Repo } from './repo';
import type { Session } from '../domain/types';
import type { Persona } from './contract';
import type { RaidStore } from './raid';
import type { SprintStore } from './sprints';
import type { GateStore } from './gates';
import type { DeliverableStore } from './deliverables';
import type { AcceptanceRecordStore } from './acceptance-record';

/** Every domain store of one backend, plus the core Repo (for fixtures such as items). */
export interface DomainStores {
  repo: Repo;
  raid: RaidStore;
  sprints: SprintStore;
  gates: GateStore;
  deliverables: DeliverableStore;
  acceptance: AcceptanceRecordStore;
}

export type MakeStores = () => DomainStores;
export type SessionFor = (persona: Persona) => Session | Promise<Session>;
export type Reset = () => void | Promise<void>;

/**
 * Registers the beforeEach that restores the seed and builds the stores, and returns accessors.
 * Call inside a describe() so each suite gets fresh state per scenario.
 */
export function useStores(make: MakeStores, sessionFor: SessionFor, reset: Reset) {
  let stores: DomainStores;
  beforeEach(async () => {
    await reset();
    stores = make();
  });
  return {
    st: () => stores,
    as: (p: Persona) => Promise.resolve(sessionFor(p)),
  };
}

/** A re-auth the route would have verified from the signed cookie just now. */
export const freshReauth = () => ({ reauthAt: new Date().toISOString(), ip: '203.0.113.50' });
