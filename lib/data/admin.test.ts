import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memoryRepo, resetDb, db } from './memory';
import { sessionFor } from '../session';
import { runAdminContract } from './contract-admin';
import { memoryAdminStore } from './admin';
import { memoryTemplateStore } from './templates-admin';
import { memoryCustomFieldStore } from './custom-fields';
import { memoryAttachmentStore } from './attachments';
import { memoryAuditStore } from './audit';
import { memoryRaidStore } from './raid';
import { memoryStorage } from '../files/storage';
import { scanFile, setScanner } from '../files/scan';

// Shared behaviour, also run against Postgres + RLS in admin-postgres.test.ts.
runAdminContract(
  'memory',
  () => ({
    repo: memoryRepo,
    admin: memoryAdminStore,
    templates: memoryTemplateStore,
    fields: memoryCustomFieldStore,
    attachments: memoryAttachmentStore,
    audit: memoryAuditStore,
    raid: memoryRaidStore,
  }),
  sessionFor,
  resetDb,
);

describe('demo store specifics', () => {
  beforeEach(() => resetDb());

  it('a deactivated user is flagged on their profile; seeded invites keep their wizard shape', async () => {
    const admin = sessionFor('u_admin');
    await memoryAdminStore.setActive(admin, 'u_cviewer', false);
    expect(db().profiles.find((p) => p.id === 'u_cviewer')!.deactivatedAt).toBeTruthy();
    db().workspace.invites.push({
      id: 'inv_old',
      email: 'wizard@konnectortech.com',
      role: 'team_member',
      status: 'pending',
      invitedBy: 'u_admin',
      createdAt: '2026-08-04T09:00:00.000Z',
    });
    expect((await memoryAdminStore.listInvites(admin))[0]).toMatchObject({
      id: 'inv_old',
      orgId: 'org_konnector',
      sentCount: 0,
      lastSentAt: null,
    });
  });

  it('memory storage keeps bytes per bucket and path and rejects path tricks', async () => {
    await memoryStorage.put('kh-org-x', 'p/i/a-file.txt', new TextEncoder().encode('hi'), 'text/plain');
    const f = await memoryStorage.read('kh-org-x', 'p/i/a-file.txt');
    expect(new TextDecoder().decode(f!.bytes)).toBe('hi');
    expect(await memoryStorage.read('kh-org-y', 'p/i/a-file.txt')).toBeNull();
    await expect(memoryStorage.put('kh-org-x', '../escape', new Uint8Array(1), 'text/plain')).rejects.toThrow(
      'Invalid',
    );
    await expect(memoryStorage.put('Bad Bucket', 'a', new Uint8Array(1), 'text/plain')).rejects.toThrow(
      'Invalid',
    );
    await memoryStorage.remove('kh-org-x', 'p/i/a-file.txt');
    expect(await memoryStorage.read('kh-org-x', 'p/i/a-file.txt')).toBeNull();
    expect(await memoryStorage.signedUrl('kh-org-x', 'p/i/a-file.txt', 'a.txt')).toBeNull();
  });
});

describe('virus-scan hook', () => {
  afterEach(() => setScanner(null));

  it('passes everything by default (placeholder) and uses an installed scanner', async () => {
    const file = { name: 'a.pdf', type: 'application/pdf', bytes: new Uint8Array([1]) };
    expect(await scanFile(file)).toEqual({ clean: true });
    setScanner({ scan: async (f) => ({ clean: f.name !== 'a.pdf', reason: 'Infected' }) });
    expect(await scanFile(file)).toEqual({ clean: false, reason: 'Infected' });
  });
});
