import { describe, expect, it } from 'vitest';
import { buildSeed } from '../data/seed';
import { canSeeProject, canSeeVisibility, redactProfile, redactProject } from './permissions';

const d = buildSeed();
const user = (id: string) => d.profiles.find((p) => p.id === id)!;
const project = (key: string) => d.projects.find((p) => p.key === key)!;

describe('canSeeProject', () => {
  it('admin sees everything', () =>
    d.projects.forEach((p) => expect(canSeeProject(user('u_admin'), p, d.members)).toBe(true)));
  it('client users only see their own org projects', () => {
    expect(canSeeProject(user('u_sponsor'), project('EHR'), d.members)).toBe(true);
    expect(canSeeProject(user('u_sponsor'), project('RVB'), d.members)).toBe(false);
    expect(canSeeProject(user('u_rsponsor'), project('EHR'), d.members)).toBe(false);
  });
  it('associate only sees explicitly assigned projects', () => {
    expect(canSeeProject(user('u_assoc'), project('EHR'), d.members)).toBe(true);
    expect(canSeeProject(user('u_assoc'), project('PSR'), d.members)).toBe(false);
  });
  it('restricted projects are hidden from non-U.S. persons even when assigned', () => {
    const p = { ...project('EHR'), restricted: true };
    expect(canSeeProject(user('u_assoc'), p, d.members)).toBe(false);
  });
  it('soft-deleted projects are admin-only', () => {
    const p = { ...project('EHR'), deletedAt: '2026-10-01' };
    expect(canSeeProject(user('u_lead'), p, d.members)).toBe(false);
    expect(canSeeProject(user('u_admin'), p, d.members)).toBe(true);
  });
});

describe('visibility and redaction', () => {
  it('clients never see internal content', () => {
    expect(canSeeVisibility(user('u_sponsor'), 'internal')).toBe(false);
    expect(canSeeVisibility(user('u_sponsor'), 'shared')).toBe(true);
    expect(canSeeVisibility(user('u_assoc'), 'internal')).toBe(true);
  });
  it('cost rates are admin-only', () => {
    expect(redactProfile(user('u_lead'), user('u_dev')).costRate).toBeUndefined();
    expect(redactProfile(user('u_admin'), user('u_dev')).costRate).toBe(95);
  });
  it('the U.S.-person flag is only shown to Admins and Leads', () => {
    expect(redactProfile(user('u_lead'), user('u_assoc')).usPerson).toBe(false);
    expect(redactProfile(user('u_team'), user('u_assoc')).usPerson).toBeUndefined();
    expect(redactProfile(user('u_sponsor'), user('u_dev')).usPerson).toBeUndefined();
  });
  it('budget is hidden from associates and clients', () => {
    expect(redactProject(user('u_assoc'), project('EHR')).bac).toBe(0);
    expect(redactProject(user('u_sponsor'), project('EHR')).bac).toBe(0);
    expect(redactProject(user('u_lead'), project('EHR')).bac).toBe(480000);
  });
});
