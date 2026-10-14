import { runRaidContract } from './contract-raid';
import { runSprintContract } from './contract-sprints';
import { runGateContract } from './contract-gates';
import { runDeliverableContract } from './contract-deliverables';
import { runInsightContract } from './contract-insight';
import { runPulseContract } from './contract-pulse';
import { runSignalContract } from './contract-signal';
import type { MakeStores, Reset, SessionFor } from './contract-support';

export type { DomainStores } from './contract-support';

/**
 * Runs every domain contract (RAID, sprints, gates, deliverables, and the Sprint 3 domains Insight,
 * Pulse and Signal) against one backend. Used by
 * lib/data/memory.test.ts (demo store) and lib/data/postgres.test.ts (Postgres + RLS). Scenarios
 * only use the store interfaces, project and item keys and ids returned by the stores.
 */
export function runDomainContracts(name: string, make: MakeStores, sessionFor: SessionFor, reset: Reset) {
  runRaidContract(name, make, sessionFor, reset);
  runSprintContract(name, make, sessionFor, reset);
  runGateContract(name, make, sessionFor, reset);
  runDeliverableContract(name, make, sessionFor, reset);
  runInsightContract(name, make, sessionFor, reset);
  runPulseContract(name, make, sessionFor, reset);
  runSignalContract(name, make, sessionFor, reset);
}
