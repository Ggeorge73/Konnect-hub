import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRepo, isPostgresEnabled } from './index';
import { memoryRepo } from './memory';
import { memoryRaidStore, raidStore } from './raid';
import { memorySprintStore, sprintStore } from './sprints';
import { gateStore, memoryGateStore } from './gates';
import { deliverableStore, memoryDeliverableStore } from './deliverables';
import { acceptanceRecordStore, memoryAcceptanceRecordStore } from './acceptance-record';

const all = () => [
  [getRepo(), memoryRepo],
  [raidStore(), memoryRaidStore],
  [sprintStore(), memorySprintStore],
  [gateStore(), memoryGateStore],
  [deliverableStore(), memoryDeliverableStore],
  [acceptanceRecordStore(), memoryAcceptanceRecordStore],
];

describe('store selection', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('demo mode uses the in-memory stores for every domain', () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('KH_DATA', '');
    expect(isPostgresEnabled()).toBe(false);
    for (const [active, memory] of all()) expect(active).toBe(memory);
  });

  it('every domain switches to Postgres exactly when getRepo() does', () => {
    // postgres.js connects lazily, so no database is needed to build the stores.
    vi.stubEnv('DATABASE_URL', 'postgres://kh@127.0.0.1:1/none');
    vi.stubEnv('KH_DATA', 'postgres');
    expect(isPostgresEnabled()).toBe(true);
    for (const [active, memory] of all()) expect(active).not.toBe(memory);
    expect(raidStore()).toBe(raidStore());
  });
});
