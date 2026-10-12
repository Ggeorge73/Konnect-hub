import { describe, expect, it } from 'vitest';
import { buildDigest } from './digest';
import { escapeHtml, notificationEmail } from './templates';
import type { Notification } from '../domain/notifications';

const now = new Date('2026-10-12T07:00:00Z');
const user = { id: 'u_dev', name: 'Adeoba Cole', email: 'adeoba@konnectortech.com' };
const n = (id: string, kind: Notification['kind'], title: string, hoursAgo = 1): Notification => ({
  id,
  userId: 'u_dev',
  projectId: 'p_ehr',
  kind,
  title,
  href: `/projects/EHR/board?item=${id}`,
  createdAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
  readAt: null,
});

describe('buildDigest', () => {
  it('returns null when there is nothing to digest (no empty emails)', () => {
    expect(buildDigest(user, [], [], now)).toBeNull();
    expect(buildDigest(user, [n('m', 'mention', 'Mentioned')], [], now)).toBeNull();
  });

  it('builds one email with every digest item, linked absolutely, and returns their ids', () => {
    const d = buildDigest(
      user,
      [n('EHR-4', 'status_change', 'EHR-4 moved to Done'), n('EHR-5', 'status_change', 'EHR-5 moved', 3)],
      [],
      now,
      'https://hub.konnectortech.com',
    )!;
    expect(d.ids).toEqual(['EHR-4', 'EHR-5']);
    expect(d.email.to).toBe(user.email);
    expect(d.email.subject).toBe('Your Konnect Hub daily digest: 2 updates');
    expect(d.email.html).toContain('Good morning, Adeoba');
    expect(d.email.html).toContain('https://hub.konnectortech.com/projects/EHR/board?item=EHR-4');
    expect(d.email.text).toContain(
      '- EHR-4 moved to Done: https://hub.konnectortech.com/projects/EHR/board?item=EHR-4',
    );
  });

  it('escapes titles in HTML', () => {
    const d = buildDigest(user, [n('x', 'status_change', '<script>alert(1)</script> & co')], [], now)!;
    expect(d.email.html).not.toContain('<script>');
    expect(d.email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
  });

  it('caps a digest at 50 entries', () => {
    const many = Array.from({ length: 60 }, (_, i) => n(`i${i}`, 'status_change', `t${i}`, (i + 1) / 10));
    expect(buildDigest(user, many, [], now)!.ids).toHaveLength(50);
  });
});

describe('notification email', () => {
  it('deep-links a gate approval straight to the portal approve dialog', () => {
    const m = notificationEmail(
      'grace@peachtreeclinic.example',
      { kind: 'gate_requested', title: 'Gate 3 ready', href: '/portal?approve=gr_1' },
      'https://hub.konnectortech.com',
    );
    expect(m.html).toContain('href="https://hub.konnectortech.com/portal?approve=gr_1"');
    expect(m.html).toContain('Review and approve');
    expect(m.text).toContain('https://hub.konnectortech.com/portal?approve=gr_1');
  });
  it('escapes all five HTML-special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
