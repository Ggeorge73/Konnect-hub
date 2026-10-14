import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from './repo';
import type { AdminStore } from './admin';
import type { TemplateStore } from './templates-admin';
import type { CustomFieldStore } from './custom-fields';
import type { AttachmentStore, StorageCallback } from './attachments';
import type { AuditStore } from './audit';
import type { RaidStore } from './raid';
import type { Reset, SessionFor } from './contract-support';
import { clearOutbox, outbox } from '../email/send';
import { DEFAULT_STATUSES } from '../domain/workflow';
import { MAX_FILE_BYTES } from '../domain/files';

export interface AdminStores {
  repo: Repo;
  admin: AdminStore;
  templates: TemplateStore;
  fields: CustomFieldStore;
  attachments: AttachmentStore;
  audit: AuditStore;
  raid: RaidStore;
}

const PDF = 'application/pdf';
const noop: StorageCallback = async () => {};

/**
 * Admin console (ADM-01) and attachments (FILE-01) rules every store pair must share: the demo
 * store (admin.test.ts) and Postgres + RLS (admin-postgres.test.ts). Uses keys, names and emails
 * from the shared seed, never store-specific ids.
 */
export function runAdminContract(
  name: string,
  make: () => AdminStores,
  sessionFor: SessionFor,
  reset: Reset,
) {
  describe(`${name} admin console + attachments contract`, () => {
    let st: AdminStores;
    const as = (p: Parameters<SessionFor>[0]) => Promise.resolve(sessionFor(p));
    beforeEach(async () => {
      await reset();
      st = make();
      clearOutbox();
    });

    const userId = async (email: string) => {
      const users = await st.admin.listUsers(await as('u_admin'));
      return users.find((u) => u.email === email)!.id;
    };
    const auditRows = async (prefix: string) =>
      (await st.audit.listAudit(await as('u_admin'), { actionPrefix: prefix, pageSize: 100 })).rows;

    it('lists every user to Admins only, and audits a role change as a permission change', async () => {
      const admin = await as('u_admin');
      const users = await st.admin.listUsers(admin);
      expect(users.map((u) => u.email)).toEqual(
        expect.arrayContaining(['tiara@konnectortech.com', 'grace@peachtreeclinic.example']),
      );
      const tiara = users.find((u) => u.email === 'tiara@konnectortech.com')!;
      expect(tiara).toMatchObject({ role: 'team_member', orgType: 'internal', deactivatedAt: null });
      await expect(st.admin.listUsers(await as('u_lead'))).rejects.toThrow('Only Admins');

      const changed = await st.admin.changeRole(admin, tiara.id, 'delivery_lead', '203.0.113.9');
      expect(changed.role).toBe('delivery_lead');
      const rows = (await auditRows('permission.role_change')).filter((r) => r.entityId === tiara.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: admin.user.id, after: { role: 'delivery_lead' } });
      expect(rows[0].ip).toBe('203.0.113.9');

      await expect(st.admin.changeRole(admin, admin.user.id, 'team_member')).rejects.toThrow('your own role');
      await expect(st.admin.changeRole(admin, tiara.id, 'client_sponsor')).rejects.toThrow(
        'not a role for Konnector',
      );
      const grace = users.find((u) => u.email === 'grace@peachtreeclinic.example')!;
      await expect(st.admin.changeRole(admin, grace.id, 'admin')).rejects.toThrow('not a role for Peachtree');
      expect((await st.admin.changeRole(admin, grace.id, 'client_member')).role).toBe('client_member');
      await expect(st.admin.changeRole(await as('u_lead'), grace.id, 'client_viewer')).rejects.toThrow(
        'Only Admins',
      );
    });

    it('deactivates and reactivates users (audited), never yourself', async () => {
      const admin = await as('u_admin');
      const viewer = await userId('vi@peachtreeclinic.example');
      const off = await st.admin.setActive(admin, viewer, false);
      expect(off.deactivatedAt).toBeTruthy();
      await expect(st.admin.resendUserInvite(admin, viewer)).rejects.toThrow('Reactivate');
      expect((await st.admin.setActive(admin, viewer, true)).deactivatedAt).toBeNull();
      expect((await auditRows('user.')).map((r) => r.action)).toEqual(['user.reactivate', 'user.deactivate']);
      await expect(st.admin.setActive(admin, admin.user.id, false)).rejects.toThrow('deactivate yourself');
      await expect(st.admin.setActive(await as('u_lead'), viewer, false)).rejects.toThrow('Only Admins');
    });

    it('invites people with a role and an org, sends the invite and re-sends it', async () => {
      const admin = await as('u_admin');
      const orgs = await st.admin.listClientOrgs(admin);
      const peachtree = orgs.find((o) => o.name === 'Peachtree Clinic Group')!;
      expect(peachtree.userCount).toBeGreaterThanOrEqual(3);
      const created = await st.admin.invite(
        admin,
        {
          emails: 'new.member@peachtreeclinic.example, grace@peachtreeclinic.example',
          role: 'client_member',
          orgId: peachtree.id,
        },
        '198.51.100.4',
      );
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        email: 'new.member@peachtreeclinic.example',
        role: 'client_member',
        orgId: peachtree.id,
        status: 'sent',
        sentCount: 1,
      });
      expect(outbox().filter((m) => m.to === 'new.member@peachtreeclinic.example')).toHaveLength(1);
      expect(outbox()[0].subject).toMatch(/invited/i);

      const again = await st.admin.resendInvite(admin, created[0].id);
      expect(again.sentCount).toBe(2);
      expect(outbox().filter((m) => m.to === 'new.member@peachtreeclinic.example')).toHaveLength(2);
      expect((await st.admin.listInvites(admin)).map((i) => i.email)).toContain(
        'new.member@peachtreeclinic.example',
      );
      expect((await auditRows('invite.')).map((r) => r.action).sort()).toEqual([
        'invite.create',
        'invite.resend',
      ]);

      await expect(
        st.admin.invite(admin, {
          emails: 'x@peachtreeclinic.example',
          role: 'team_member',
          orgId: peachtree.id,
        }),
      ).rejects.toThrow('not a role for Peachtree');
      await expect(
        st.admin.invite(await as('u_lead'), {
          emails: 'y@x.com',
          role: 'client_member',
          orgId: peachtree.id,
        }),
      ).rejects.toThrow('Only Admins');

      await st.admin.resendUserInvite(admin, await userId('tiara@konnectortech.com'));
      expect(outbox().some((m) => m.to === 'tiara@konnectortech.com')).toBe(true);

      await st.admin.revokeInvite(admin, created[0].id);
      expect((await st.admin.listInvites(admin)).some((i) => i.id === created[0].id)).toBe(false);
    });

    it('edits client orgs (name and logo), audited, Admin only', async () => {
      const admin = await as('u_admin');
      const rvb = (await st.admin.listClientOrgs(admin)).find((o) => o.name === 'Riverbend County IT')!;
      const org = await st.admin.updateClientOrg(admin, rvb.id, {
        name: 'Riverbend County',
        logoUrl: '/clients/riverbend.svg',
      });
      expect(org).toMatchObject({
        name: 'Riverbend County',
        logoUrl: '/clients/riverbend.svg',
        type: 'client',
      });
      await expect(
        st.admin.updateClientOrg(admin, rvb.id, { name: 'Peachtree Clinic Group', logoUrl: '' }),
      ).rejects.toThrow('already exists');
      await expect(
        st.admin.updateClientOrg(await as('u_lead'), rvb.id, { name: 'Nope', logoUrl: '' }),
      ).rejects.toThrow('Only Admins');
      expect((await auditRows('organization.update')).length).toBe(1);
    });

    it('custom templates: Admins derive one, Leads create projects from it, built-ins stay fixed', async () => {
      const admin = await as('u_admin');
      const lead = await as('u_lead');
      const builtin = await st.templates.listTemplates(lead);
      expect(builtin.map((t) => t.id)).toEqual(['kdf-hybrid', 'kanban-retainer', 'advisory']);
      await expect(st.templates.listTemplates(await as('u_sponsor'))).rejects.toThrow('Konnector staff');
      const base = builtin.find((t) => t.id === 'kanban-retainer')!;
      const input = {
        baseId: base.id,
        name: 'Managed Service Retainer',
        description: '',
        phases: base.phases.map((p) => ({
          gate: p.gate,
          criteria: p.gate === 3 ? ['Quarterly service review accepted', 'SLA report shared'] : p.criteria,
        })),
        raidCategories: ['Service', 'Vendor', 'service'],
      };
      await expect(st.templates.createTemplate(lead, input)).rejects.toThrow('Only Admins');
      const tpl = await st.templates.createTemplate(admin, input);
      expect(tpl).toMatchObject({
        id: 'custom-managed-service-retainer',
        builtin: false,
        baseId: 'kanban-retainer',
      });
      expect(tpl.raidCategories).toEqual(['Service', 'Vendor']);
      expect(tpl.phases[2]).toMatchObject({
        name: 'Execute',
        criteria: ['Quarterly service review accepted', 'SLA report shared'],
      });
      await expect(st.templates.createTemplate(admin, input)).rejects.toThrow('already exists');
      await expect(
        st.templates.createTemplate(admin, {
          ...input,
          name: 'Empty gate',
          phases: input.phases.map((p) => ({ ...p, criteria: [] })),
        }),
      ).rejects.toThrow();

      const orgs = await st.repo.listOrgs(lead);
      const project = await st.repo.createProject(lead, {
        name: 'Managed service pilot',
        key: 'MSP',
        clientOrgId: orgs.find((o) => o.name === 'Peachtree Clinic Group')!.id,
        leadId: lead.user.id,
        startDate: '2026-11-02',
        targetDate: '2027-03-26',
        methodology: 'kanban',
        contractType: 'retainer',
        bac: 0,
        description: '',
        templateId: tpl.id,
      });
      const bundle = await st.repo.getProjectBundle(lead, project.key);
      expect(bundle.phases).toHaveLength(5);
      const execute = bundle.phases.find((p) => p.gate === 3)!;
      expect(
        bundle.criteria
          .filter((c) => c.phaseId === execute.id)
          .map((c) => c.text)
          .sort(),
      ).toEqual(['Quarterly service review accepted', 'SLA report shared']);

      await expect(st.templates.archiveTemplate(admin, 'kdf-hybrid')).rejects.toThrow('Built-in');
      await st.templates.archiveTemplate(admin, tpl.id);
      expect((await st.templates.listTemplates(lead)).some((t) => t.id === tpl.id)).toBe(false);
      expect(
        (await st.templates.listTemplates(admin, { includeArchived: true })).some((t) => t.id === tpl.id),
      ).toBe(true);
      await expect(
        st.repo.createProject(lead, { ...project, key: 'MSP2', templateId: tpl.id, description: '' }),
      ).rejects.toThrow('template');
      expect((await auditRows('template.')).map((r) => r.action).sort()).toEqual([
        'template.archive',
        'template.create',
      ]);
    });

    it('workflow: Admins rename columns and set WIP limits; Accepted and the column set stay fixed', async () => {
      const admin = await as('u_admin');
      const sponsor = await as('u_sponsor');
      expect(await st.templates.getWorkflow(sponsor, 'EHR')).toEqual(DEFAULT_STATUSES);
      await expect(st.templates.getWorkflow(await as('u_rsponsor'), 'EHR')).rejects.toThrow(
        'Project not found',
      );
      const edited = DEFAULT_STATUSES.map((s) =>
        s.id === 'in_progress'
          ? { id: s.id, label: 'Building', wipLimit: 3 }
          : s.id === 'ready'
            ? { ...s, wipLimit: 10 }
            : s,
      );
      const saved = await st.templates.updateWorkflow(admin, 'EHR', { statuses: edited });
      expect(saved.find((s) => s.id === 'in_progress')).toEqual({
        id: 'in_progress',
        label: 'Building',
        wipLimit: 3,
      });
      expect(await st.templates.getWorkflow(await as('u_dev'), 'EHR')).toEqual(saved);
      expect(await st.templates.getWorkflow(admin, 'PSR')).toEqual(DEFAULT_STATUSES);

      const rename = (label: string, wipLimit?: number) => ({
        statuses: DEFAULT_STATUSES.map((s) => (s.id === 'accepted' ? { id: s.id, label, wipLimit } : s)),
      });
      await expect(st.templates.updateWorkflow(admin, 'EHR', rename('Signed off'))).rejects.toThrow(
        'Accepted is fixed',
      );
      await expect(st.templates.updateWorkflow(admin, 'EHR', rename('Accepted', 5))).rejects.toThrow(
        'Accepted is fixed',
      );
      await expect(
        st.templates.updateWorkflow(admin, 'EHR', {
          statuses: DEFAULT_STATUSES.filter((s) => s.id !== 'accepted'),
        }),
      ).rejects.toThrow('Accepted is fixed');
      await expect(
        st.templates.updateWorkflow(admin, 'EHR', { statuses: [...DEFAULT_STATUSES].reverse() }),
      ).rejects.toThrow('reordered');
      await expect(
        st.templates.updateWorkflow(admin, 'EHR', {
          statuses: DEFAULT_STATUSES.map((s) => (s.id === 'ready' ? { ...s, label: 'Backlog' } : s)),
        }),
      ).rejects.toThrow('Two columns');
      await expect(
        st.templates.updateWorkflow(await as('u_lead'), 'EHR', { statuses: edited }),
      ).rejects.toThrow('Only Admins');
      expect((await auditRows('workflow.update')).length).toBe(1);
    });

    it('custom fields: Admins define them; staff fill them in; clients see shared fields on shared items', async () => {
      const admin = await as('u_admin');
      const dev = await as('u_dev');
      const sponsor = await as('u_sponsor');
      const internal = await st.fields.listFields(dev);
      expect(internal.map((f) => f.name)).toEqual(['Site', 'Cost centre']);
      expect((await st.fields.listFields(sponsor)).map((f) => f.name)).toEqual(['Site']);
      const byName = Object.fromEntries(internal.map((f) => [f.name, f.id]));

      expect(Object.values(await st.fields.getItemValues(dev, 'EHR-9')).sort()).toEqual([
        'CC-4410',
        'Midtown',
      ]);
      expect(await st.fields.getItemValues(sponsor, 'EHR-9')).toEqual({ [byName.Site]: 'Midtown' });
      await expect(st.fields.getItemValues(sponsor, 'EHR-12')).rejects.toThrow('Item not found');
      await expect(st.fields.getItemValues(await as('u_rsponsor'), 'EHR-9')).rejects.toThrow('not found');

      await expect(
        st.fields.createField(await as('u_lead'), { name: 'Contract line', kind: 'number' }),
      ).rejects.toThrow('Only Admins');
      await expect(
        st.fields.createField(admin, { name: 'Phase', kind: 'select', options: [] }),
      ).rejects.toThrow();
      await expect(st.fields.createField(admin, { name: 'site', kind: 'text' })).rejects.toThrow(
        'already exists',
      );
      const line = await st.fields.createField(admin, { name: 'Contract line', kind: 'number' });
      const due = await st.fields.createField(admin, { name: 'Go-live', kind: 'date', visibility: 'shared' });
      expect(line).toMatchObject({ kind: 'number', options: [], visibility: 'internal', archivedAt: null });

      const vals = await st.fields.setItemValue(dev, 'EHR-9', line.id, '12.50');
      expect(vals[line.id]).toBe('12.5');
      await expect(st.fields.setItemValue(dev, 'EHR-9', line.id, 'twelve')).rejects.toThrow(
        'must be a number',
      );
      await expect(st.fields.setItemValue(dev, 'EHR-9', due.id, '2027-02-30')).rejects.toThrow('date');
      await expect(st.fields.setItemValue(dev, 'EHR-9', byName.Site, 'Atlanta')).rejects.toThrow('one of');
      await st.fields.setItemValue(dev, 'EHR-9', due.id, '2027-01-29');
      await expect(st.fields.setItemValue(sponsor, 'EHR-9', due.id, '2027-01-30')).rejects.toThrow(
        'cannot edit',
      );
      expect(await st.fields.getItemValues(sponsor, 'EHR-9')).toEqual({
        [byName.Site]: 'Midtown',
        [due.id]: '2027-01-29',
      });
      const cleared = await st.fields.setItemValue(dev, 'EHR-9', byName['Cost centre'], null);
      expect(cleared[byName['Cost centre']]).toBeUndefined();

      const all = await st.fields.listProjectValues(dev, 'EHR');
      const ehr9 = (await st.repo.getItem(dev, 'EHR-9')).item.id;
      expect(all[ehr9][line.id]).toBe('12.5');
      const forSponsor = await st.fields.listProjectValues(sponsor, 'EHR');
      expect(Object.values(forSponsor).every((v) => !(line.id in v))).toBe(true);

      const archived = await st.fields.updateField(admin, line.id, { archived: true });
      expect(archived.archivedAt).toBeTruthy();
      expect((await st.fields.listFields(dev)).some((f) => f.id === line.id)).toBe(false);
      await expect(st.fields.setItemValue(dev, 'EHR-9', line.id, 3)).rejects.toThrow('archived');
      expect((await st.fields.updateField(admin, due.id, { name: 'Go-live date' })).name).toBe(
        'Go-live date',
      );
      expect((await auditRows('custom_field.')).length).toBe(4);
    });

    it('attachments: clients never see internal files; uploads respect roles, limits and comments', async () => {
      const dev = await as('u_dev');
      const sponsor = await as('u_sponsor');
      const lead = await as('u_lead');
      const up = (
        s: typeof dev,
        entityType: 'work_item' | 'raid' | 'comment',
        entityId: string,
        extra = {},
      ) =>
        st.attachments.create(
          s,
          { entityType, entityId, fileName: 'scope.pdf', mimeType: PDF, sizeBytes: 1200, ...extra },
          noop,
        );

      // Seeded: a shared PDF on EHR-9, an internal spreadsheet on EHR-12.
      expect((await st.attachments.list(sponsor, 'work_item', 'EHR-9')).map((a) => a.fileName)).toEqual([
        'progress-note-v2.pdf',
      ]);
      const seededInternal = (await st.attachments.list(dev, 'work_item', 'EHR-12'))[0];
      expect(seededInternal.visibility).toBe('internal');
      await expect(st.attachments.list(sponsor, 'work_item', 'EHR-12')).rejects.toThrow('not found');
      await expect(st.attachments.get(sponsor, seededInternal.id)).rejects.toThrow('File not found');
      await expect(st.attachments.list(await as('u_rsponsor'), 'work_item', 'EHR-9')).rejects.toThrow(
        'not found',
      );

      const internal = await up(dev, 'work_item', 'EHR-9');
      const shared = await up(dev, 'work_item', 'EHR-9', { fileName: 'plan.pdf', visibility: 'shared' });
      expect(internal.visibility).toBe('internal');
      const sponsorView = await st.attachments.list(sponsor, 'work_item', 'EHR-9');
      expect(sponsorView.map((a) => a.fileName)).toEqual(['progress-note-v2.pdf', 'plan.pdf']);
      await expect(st.attachments.get(sponsor, internal.id)).rejects.toThrow('File not found');
      const stored = await st.attachments.get(sponsor, shared.id);
      expect(stored.bucket).toMatch(/^kh-org-/);
      expect(stored.storagePath).toContain(shared.id);
      expect('bucket' in sponsorView[1]).toBe(false);

      // Client uploads are always shared; viewers are read-only.
      const fromClient = await up(sponsor, 'work_item', 'EHR-9', {
        fileName: 'sign-off.pdf',
        visibility: 'internal',
      });
      expect(fromClient.visibility).toBe('shared');
      await expect(up(await as('u_cviewer'), 'work_item', 'EHR-9')).rejects.toThrow('Viewers');
      await expect(up(sponsor, 'work_item', 'EHR-12')).rejects.toThrow('not found');

      // Limits: 25 MB and the type allow-list.
      await expect(up(dev, 'work_item', 'EHR-9', { sizeBytes: MAX_FILE_BYTES + 1 })).rejects.toThrow('limit');
      await expect(
        up(dev, 'work_item', 'EHR-9', { fileName: 'run.exe', mimeType: 'application/x-msdownload' }),
      ).rejects.toThrow('not allowed');
      await expect(
        up(dev, 'work_item', 'EHR-9', { fileName: 'x.html', mimeType: 'text/html' }),
      ).rejects.toThrow('not allowed');

      // A failed storage write records nothing.
      await expect(
        st.attachments.create(
          dev,
          { entityType: 'work_item', entityId: 'EHR-9', fileName: 'lost.pdf', mimeType: PDF, sizeBytes: 10 },
          async () => {
            throw new Error('storage down');
          },
        ),
      ).rejects.toThrow('storage down');
      expect(
        (await st.attachments.list(dev, 'work_item', 'EHR-9')).some((a) => a.fileName === 'lost.pdf'),
      ).toBe(false);

      // Comments: a file on an internal comment is internal; on a shared one the uploader chooses.
      const comments = (await st.repo.getItem(lead, 'EHR-7')).comments;
      const internalComment = comments.find((c) => c.visibility === 'internal')!;
      const sharedComment = comments.find((c) => c.visibility === 'shared')!;
      const onInternal = await up(lead, 'comment', internalComment.id, { visibility: 'shared' });
      expect(onInternal).toMatchObject({
        visibility: 'internal',
        commentId: internalComment.id,
        entityType: 'work_item',
      });
      const onShared = await up(lead, 'comment', sharedComment.id, {
        visibility: 'shared',
        fileName: 'notes.pdf',
      });
      await expect(st.attachments.get(sponsor, onInternal.id)).rejects.toThrow('File not found');
      expect((await st.attachments.list(sponsor, 'work_item', 'EHR-7')).map((a) => a.id)).toEqual([
        onShared.id,
      ]);
      await expect(up(sponsor, 'comment', internalComment.id)).rejects.toThrow('not found');

      // RAID entries: internal entries are invisible to clients, files on shared ones follow their own flag.
      const raid = await st.raid.listRaid(lead, { projectId: 'EHR' });
      const sharedRisk = raid.find((r) => r.visibility === 'shared')!;
      const internalRisk = raid.find((r) => r.visibility === 'internal')!;
      const riskFile = await up(lead, 'raid', sharedRisk.id, { visibility: 'shared' });
      await up(lead, 'raid', sharedRisk.id, { fileName: 'internal-notes.txt', mimeType: 'text/plain' });
      expect((await st.attachments.list(sponsor, 'raid', sharedRisk.id)).map((a) => a.id)).toEqual([
        riskFile.id,
      ]);
      await up(lead, 'raid', internalRisk.id);
      await expect(st.attachments.list(sponsor, 'raid', internalRisk.id)).rejects.toThrow('not found');

      // Only the uploader or an Admin deletes; deletions are audited.
      await expect(st.attachments.remove(await as('u_team'), shared.id)).rejects.toThrow('uploader');
      const erased: string[] = [];
      await st.attachments.remove(dev, shared.id, async (loc) => {
        erased.push(loc.storagePath);
      });
      expect(erased).toEqual([stored.storagePath]);
      await st.attachments.remove(await as('u_admin'), fromClient.id);
      await expect(st.attachments.get(dev, shared.id)).rejects.toThrow('File not found');
      expect((await auditRows('attachment.delete')).length).toBe(2);
    });
  });
}
