import { describe, expect, it } from 'vitest';
import {
  adminInviteSchema,
  buildCustomTemplate,
  canSeeField,
  customFieldSchema,
  deactivateError,
  inviteRoleError,
  nameFromEmail,
  normaliseFieldValue,
  normaliseWorkflow,
  patchField,
  resolveWorkflow,
  roleChangeError,
  rolesForOrg,
  statusLabels,
  templateCreateSchema,
  templateIdFor,
  type CustomField,
} from './admin';
import { TEMPLATES } from './templates';
import { DEFAULT_STATUSES } from './workflow';

const konnector = { type: 'internal' as const, name: 'Konnector LLC' };
const peachtree = { type: 'client' as const, name: 'Peachtree Clinic Group' };
const admin = { id: 'a', role: 'admin' as const };

describe('roles and users', () => {
  it('Konnector users hold Konnector roles, client users client roles', () => {
    expect(rolesForOrg(konnector)).toEqual(['admin', 'delivery_lead', 'team_member', 'associate']);
    expect(rolesForOrg(peachtree)).toEqual(['client_sponsor', 'client_member', 'client_viewer']);
    expect(roleChangeError(admin, { id: 'b' }, konnector, 'delivery_lead')).toBeNull();
    expect(roleChangeError(admin, { id: 'b' }, konnector, 'client_sponsor')).toMatch(
      'not a role for Konnector',
    );
    expect(roleChangeError(admin, { id: 'b' }, peachtree, 'associate')).toMatch('not a role for Peachtree');
  });

  it('only Admins change roles, never their own; nobody deactivates themselves', () => {
    expect(
      roleChangeError({ id: 'l', role: 'delivery_lead' }, { id: 'b' }, konnector, 'team_member'),
    ).toMatch('Only Admins');
    expect(roleChangeError(admin, admin, konnector, 'team_member')).toMatch('your own role');
    expect(deactivateError(admin, admin)).toMatch('yourself');
    expect(deactivateError({ id: 't', role: 'team_member' }, admin)).toMatch('Only Admins');
    expect(deactivateError(admin, { id: 'b' })).toBeNull();
  });

  it('invites need emails, a role and an org that fits the role', () => {
    expect(
      adminInviteSchema.safeParse({ emails: 'a@x.com; b@x.com', role: 'client_member', orgId: 'o' }).success,
    ).toBe(true);
    expect(adminInviteSchema.safeParse({ emails: 'nope', role: 'client_member', orgId: 'o' }).success).toBe(
      false,
    );
    expect(adminInviteSchema.safeParse({ emails: 'a@x.com', role: 'client_member', orgId: '' }).success).toBe(
      false,
    );
    expect(inviteRoleError(peachtree, 'client_viewer')).toBeNull();
    expect(inviteRoleError(peachtree, 'team_member')).toMatch('not a role');
    expect(inviteRoleError(undefined, 'team_member')).toMatch('Unknown organization');
    expect(nameFromEmail('ada.okafor@konnectortech.com')).toBe('Ada Okafor');
    expect(nameFromEmail('j_doe-smith@x.com')).toBe('J Doe Smith');
  });
});

describe('custom templates', () => {
  const base = TEMPLATES[1];
  const input = templateCreateSchema.parse({
    baseId: base.id,
    name: '  Managed Service  ',
    phases: base.phases.map((p) => ({ gate: p.gate, criteria: [...p.criteria, ` ${p.criteria[0]} `] })),
    raidCategories: ['Service', 'service', 'Vendor'],
  });

  it('keeps the gate names, dedupes criteria and categories', () => {
    const t = buildCustomTemplate(base, input, 'custom-managed-service');
    expect(t.name).toBe('Managed Service');
    expect(t.description).toBe(`Based on ${base.name}.`);
    expect(t.phases.map((p) => p.name)).toEqual(['Mobilize', 'Plan', 'Execute', 'Accept', 'Transition']);
    expect(t.phases[0].criteria).toEqual(base.phases[0].criteria);
    expect(t.raidCategories).toEqual(['Service', 'Vendor']);
  });

  it('needs five distinct gates with criteria', () => {
    expect(templateCreateSchema.safeParse({ ...input, phases: input.phases.slice(0, 4) }).success).toBe(
      false,
    );
    expect(
      templateCreateSchema.safeParse({ ...input, phases: input.phases.map((p) => ({ ...p, criteria: [] })) })
        .success,
    ).toBe(false);
    expect(() =>
      buildCustomTemplate(base, { ...input, phases: input.phases.map((p) => ({ ...p, gate: 1 })) }, 'x'),
    ).toThrow('five gates');
  });

  it('ids are url-safe and unique', () => {
    expect(templateIdFor('Managed Service — Gold!', [])).toBe('custom-managed-service-gold');
    expect(templateIdFor('Gold', ['custom-gold', 'custom-gold-2'])).toBe('custom-gold-3');
    expect(templateIdFor('!!!', [])).toBe('custom-template');
  });
});

describe('workflow configuration', () => {
  const edit = (f: (s: (typeof DEFAULT_STATUSES)[number]) => object) =>
    DEFAULT_STATUSES.map((s) => ({ ...s, ...f(s) })) as Parameters<typeof normaliseWorkflow>[0];

  it('renames columns and sets WIP limits', () => {
    const r = normaliseWorkflow(edit((s) => (s.id === 'ready' ? { label: ' Groomed ', wipLimit: 8 } : {})));
    expect(r.ok && r.statuses[1]).toEqual({ id: 'ready', label: 'Groomed', wipLimit: 8 });
    const cleared = normaliseWorkflow(edit((s) => (s.id === 'in_progress' ? { wipLimit: null } : {})));
    expect(cleared.ok && cleared.statuses[2]).toEqual({ id: 'in_progress', label: 'In Progress' });
  });

  it('keeps Accepted and the column set fixed', () => {
    const bad = (x: ReturnType<typeof normaliseWorkflow>) => (x.ok ? '' : x.error);
    expect(bad(normaliseWorkflow(edit((s) => (s.id === 'accepted' ? { label: 'Signed off' } : {}))))).toMatch(
      'Accepted is fixed',
    );
    expect(bad(normaliseWorkflow(edit((s) => (s.id === 'accepted' ? { wipLimit: 3 } : {}))))).toMatch(
      'Accepted is fixed',
    );
    expect(bad(normaliseWorkflow(DEFAULT_STATUSES.slice(0, 6)))).toMatch('Accepted is fixed');
    expect(bad(normaliseWorkflow([...DEFAULT_STATUSES].reverse()))).toMatch('reordered');
    expect(bad(normaliseWorkflow(edit((s) => (s.id === 'done' ? { label: 'backlog' } : {}))))).toMatch(
      'Two columns',
    );
  });

  it('a project without a saved workflow uses the default', () => {
    expect(resolveWorkflow(null)).toEqual(DEFAULT_STATUSES);
    expect(resolveWorkflow([])).toEqual(DEFAULT_STATUSES);
    expect(statusLabels(resolveWorkflow(null)).client_review).toBe('Client Review');
  });
});

describe('custom fields', () => {
  const f = (kind: CustomField['kind'], options: string[] = []): CustomField => ({
    id: 'f',
    name: 'Field',
    kind,
    options,
    visibility: 'internal',
    position: 1,
    archivedAt: null,
    createdAt: '',
  });

  it('validates and normalises values per kind', () => {
    expect(normaliseFieldValue(f('number'), '012.50')).toEqual({ ok: true, value: '12.5' });
    expect(normaliseFieldValue(f('number'), 7)).toEqual({ ok: true, value: '7' });
    expect(normaliseFieldValue(f('number'), '1e3').ok).toBe(false);
    expect(normaliseFieldValue(f('date'), '2027-01-29')).toEqual({ ok: true, value: '2027-01-29' });
    expect(normaliseFieldValue(f('date'), '2027-02-30').ok).toBe(false);
    expect(normaliseFieldValue(f('select', ['A', 'B']), 'B')).toEqual({ ok: true, value: 'B' });
    expect(normaliseFieldValue(f('select', ['A', 'B']), 'C').ok).toBe(false);
    expect(normaliseFieldValue(f('text'), '  hi ')).toEqual({ ok: true, value: 'hi' });
    expect(normaliseFieldValue(f('text'), 'x'.repeat(501)).ok).toBe(false);
    expect(normaliseFieldValue(f('text'), '  ')).toEqual({ ok: true, value: null });
    expect(normaliseFieldValue(f('number'), null)).toEqual({ ok: true, value: null });
  });

  it('select fields need options; other kinds drop them', () => {
    expect(customFieldSchema.safeParse({ name: 'Site', kind: 'select', options: [] }).success).toBe(false);
    expect(
      customFieldSchema.parse({ name: 'Site', kind: 'select', options: ['A', 'a', 'B'] }).options,
    ).toEqual(['A', 'B']);
    expect(customFieldSchema.parse({ name: 'Notes', kind: 'text', options: ['x'] }).options).toEqual([]);
  });

  it('patches keep the kind; archiving hides the field from clients', () => {
    const sel = { ...f('select', ['A']), visibility: 'shared' as const };
    expect(() => patchField(sel, { options: [] }, 'now')).toThrow('needs options');
    const archived = patchField(sel, { archived: true }, 'now');
    expect(archived.archivedAt).toBe('now');
    expect(patchField(archived, { archived: false }, 'later').archivedAt).toBeNull();
    expect(canSeeField({ role: 'client_sponsor' }, sel)).toBe(true);
    expect(canSeeField({ role: 'client_sponsor' }, archived)).toBe(false);
    expect(canSeeField({ role: 'client_viewer' }, f('text'))).toBe(false);
    expect(canSeeField({ role: 'associate' }, f('text'))).toBe(true);
  });
});
