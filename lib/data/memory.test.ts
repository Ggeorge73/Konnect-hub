import { beforeEach, describe, expect, it } from 'vitest';
import { memoryRepo as repo, resetDb, db } from './memory';
import { sessionFor } from '../session';
import { runRepoContract } from './contract';
import { runDomainContracts } from './contract-domains';
import { memoryRaidStore } from './raid';
import { memorySprintStore } from './sprints';
import { memoryGateStore } from './gates';
import { memoryDeliverableStore } from './deliverables';
import { memoryAcceptanceRecordStore } from './acceptance-record';
import { memoryInsightStore } from './insight';
import { memoryMetricsStore } from './metrics';
import { memoryReportStore } from './reports';
import { memorySignalStore } from './notify';
import { runLedgerContract } from './contract-ledger';
import { memoryLedgerStore } from './ledger';
import { memoryAuditStore } from './audit';

const as = (id: string) => sessionFor(id);

// Shared behaviour, also run against Postgres + RLS in postgres.test.ts.
runRepoContract('memory', () => repo, sessionFor, resetDb);
runDomainContracts(
  'memory',
  () => ({
    repo,
    raid: memoryRaidStore,
    sprints: memorySprintStore,
    gates: memoryGateStore,
    deliverables: memoryDeliverableStore,
    acceptance: memoryAcceptanceRecordStore,
    insight: memoryInsightStore,
    metrics: memoryMetricsStore,
    reports: memoryReportStore,
    signal: memorySignalStore,
  }),
  sessionFor,
  resetDb,
);
runLedgerContract(
  'memory',
  () => ({ repo, ledger: memoryLedgerStore, audit: memoryAuditStore }),
  sessionFor,
  resetDb,
);

// Demo-store specifics: the audit trail lives in db().audit here (audit_log in Postgres).
describe('memory repo — audit trail', () => {
  beforeEach(() => resetDb());

  it('a Peachtree client never sees Riverbend items by legacy project id', async () => {
    const items = await repo.listItems(as('u_sponsor'), {});
    expect(items.some((i) => i.projectId === 'p_rvb')).toBe(false);
  });

  it('client and offline acceptances are both audited', async () => {
    await repo.updateItem(as('u_sponsor'), 'EHR-9', { status: 'accepted' });
    await repo.updateItem(as('u_lead'), 'EHR-10', {
      status: 'accepted',
      offlineAcceptanceNote: 'Accepted by Grace in steering 10/12',
    });
    expect(db().audit.filter((a) => a.action === 'acceptance.decide').length).toBe(2);
  });

  it('visibility changes are audited', async () => {
    await repo.updateItem(as('u_lead'), 'EHR-12', { visibility: 'shared' });
    expect(db().audit.some((a) => a.action === 'visibility.change')).toBe(true);
  });
});
