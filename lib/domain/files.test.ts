import { describe, expect, it } from 'vitest';
import {
  ACCEPT_ATTR,
  bucketForOrg,
  canDeleteAttachment,
  canUpload,
  contentDisposition,
  contentTypeFor,
  formatBytes,
  LOGO_TYPES,
  MAX_FILE_BYTES,
  safeFileName,
  storagePathFor,
  uploadError,
  uploadVisibility,
} from './files';

describe('upload limits', () => {
  it('allows common documents and images up to 25 MB', () => {
    expect(uploadError({ name: 'scope.pdf', size: 1000, type: 'application/pdf' })).toBeNull();
    expect(uploadError({ name: 'big.pdf', size: MAX_FILE_BYTES, type: 'application/pdf' })).toBeNull();
    expect(uploadError({ name: 'big.pdf', size: MAX_FILE_BYTES + 1, type: 'application/pdf' })).toMatch(
      'limit is 25.0 MB',
    );
    expect(uploadError({ name: 'empty.txt', size: 0, type: 'text/plain' })).toMatch('empty');
  });

  it('refuses executables, HTML, SVG and archives', () => {
    for (const [name, type] of [
      ['run.exe', 'application/x-msdownload'],
      ['page.html', 'text/html'],
      ['logo.svg', 'image/svg+xml'],
      ['all.zip', 'application/zip'],
      ['noext', ''],
    ])
      expect(uploadError({ name, size: 10, type })).toMatch('not allowed');
  });

  it('infers the type from the extension when the browser sends none, never trusting a mismatch', () => {
    expect(contentTypeFor('report.XLSX', '')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(contentTypeFor('notes.csv', 'application/octet-stream')).toBe('text/csv');
    expect(contentTypeFor('evil.html', 'application/pdf')).toBeNull();
    expect(contentTypeFor('photo.jpg', 'image/jpeg; charset=binary')).toBe('image/jpeg');
    expect(uploadError({ name: 'a.png', size: 10, type: 'image/png' }, { types: LOGO_TYPES })).toBeNull();
    expect(uploadError({ name: 'a.pdf', size: 10, type: 'application/pdf' }, { types: LOGO_TYPES })).toMatch(
      'not allowed',
    );
    expect(ACCEPT_ATTR).toContain('.pdf');
  });

  it('formats sizes', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('who sees and changes files', () => {
  it('client uploads are shared; files on internal comments are internal; staff choose, internal by default', () => {
    expect(uploadVisibility({ role: 'client_member' }, 'internal')).toBe('shared');
    expect(uploadVisibility({ role: 'team_member' }, undefined)).toBe('internal');
    expect(uploadVisibility({ role: 'team_member' }, 'shared')).toBe('shared');
    expect(uploadVisibility({ role: 'delivery_lead' }, 'shared', { visibility: 'internal' })).toBe(
      'internal',
    );
    expect(uploadVisibility({ role: 'delivery_lead' }, 'shared', { visibility: 'shared' })).toBe('shared');
  });

  it('viewers never upload; uploaders and Admins delete', () => {
    expect(canUpload({ role: 'client_viewer' })).toBe(false);
    expect(canUpload({ role: 'client_sponsor' })).toBe(true);
    expect(canDeleteAttachment({ id: 'u1', role: 'team_member' }, { uploadedBy: 'u1' })).toBe(true);
    expect(canDeleteAttachment({ id: 'u2', role: 'delivery_lead' }, { uploadedBy: 'u1' })).toBe(false);
    expect(canDeleteAttachment({ id: 'u3', role: 'admin' }, { uploadedBy: 'u1' })).toBe(true);
  });
});

describe('storage locations and download headers', () => {
  it('one private bucket per client org with a safe name', () => {
    expect(bucketForOrg('org_peachtree')).toBe('kh-org-org-peachtree');
    expect(bucketForOrg('A0000000-0000-4000-8000-000000000002')).toBe(
      'kh-org-a0000000-0000-4000-8000-000000000002',
    );
  });

  it('file names never carry paths, control characters or quotes', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\me\\plan "v2".pdf')).toBe('plan _v2_.pdf');
    expect(safeFileName('..')).toBe('file');
    expect(safeFileName(`${'a'.repeat(200)}.pdf`)).toHaveLength(111);
    expect(storagePathFor('p1', 'i1', 'at1', 'my plan.pdf')).toBe('p1/i1/at1-my_plan.pdf');
  });

  it('Content-Disposition has an ASCII fallback and the UTF-8 name', () => {
    expect(contentDisposition('Résumé "final".pdf')).toBe(
      `attachment; filename="R_sum_ _final_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20_final_.pdf`,
    );
    expect(contentDisposition('logo.png', true)).toMatch(/^inline;/);
  });
});
