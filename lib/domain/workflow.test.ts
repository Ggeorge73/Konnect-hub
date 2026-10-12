import { describe, expect, it } from 'vitest';
import { canTransition } from './workflow';

describe('canTransition — Accepted is a status, not a feeling', () => {
  it('lets a client sponsor accept', () =>
    expect(canTransition('client_review', 'accepted', { role: 'client_sponsor' }).ok).toBe(true));
  it('lets a client member accept', () =>
    expect(canTransition('client_review', 'accepted', { role: 'client_member' }).ok).toBe(true));
  it('blocks a client viewer from any move', () =>
    expect(canTransition('client_review', 'in_progress', { role: 'client_viewer' }).ok).toBe(false));
  it('blocks a team member from accepting', () =>
    expect(canTransition('done', 'accepted', { role: 'team_member' }).ok).toBe(false));
  it('blocks a lead without a note', () =>
    expect(canTransition('done', 'accepted', { role: 'delivery_lead' }).ok).toBe(false));
  it('blocks a lead with a blank note', () =>
    expect(canTransition('done', 'accepted', { role: 'delivery_lead', offlineAcceptanceNote: '  ' }).ok).toBe(
      false,
    ));
  it('allows a lead with an offline acceptance note', () =>
    expect(
      canTransition('done', 'accepted', {
        role: 'delivery_lead',
        offlineAcceptanceNote: 'Grace accepted by email 10/9',
      }).ok,
    ).toBe(true));
  it('allows internal users to move freely between other statuses', () =>
    expect(canTransition('backlog', 'done', { role: 'associate' }).ok).toBe(true));
  it('limits clients to accepting or sending back', () => {
    expect(canTransition('client_review', 'in_progress', { role: 'client_sponsor' }).ok).toBe(true);
    expect(canTransition('backlog', 'done', { role: 'client_sponsor' }).ok).toBe(false);
  });
});
