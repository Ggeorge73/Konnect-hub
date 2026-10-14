import type { CustomField, TemplateSummary, WorkflowStatus } from '../domain/admin';
import { bucketForOrg, storagePathFor, type StoredAttachment } from '../domain/files';

/** Team Portal admin console + attachments tables in the demo store (`db().admin`). */
export interface AdminState {
  /** Custom project templates (the three built-ins live in lib/domain/templates.ts). */
  templates: TemplateSummary[];
  /** Saved workflows by project id; a project without one uses DEFAULT_STATUSES. */
  workflows: Record<string, WorkflowStatus[]>;
  fields: CustomField[];
  fieldValues: { projectId: string; itemId: string; fieldId: string; value: string }[];
  attachments: StoredAttachment[];
}

const T0 = '2026-08-03T09:00:00.000Z';

/**
 * Mirrors supabase/seed.sql: two custom fields (a shared "Site" select and an internal "Cost
 * centre"), their values on EHR-9 and RVB-2, and the three seeded attachments (a shared PDF on
 * EHR-9, an internal spreadsheet on EHR-12 and a shared PDF on RVB-2). The bytes of seeded
 * attachments are not stored, so their download answers 404 ("no longer available").
 */
export function seedAdmin(): { admin: AdminState } {
  const att = (
    id: string,
    projectId: string,
    orgId: string,
    itemId: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
    uploadedBy: string,
    visibility: 'internal' | 'shared',
  ): StoredAttachment => ({
    id,
    projectId,
    entityType: 'work_item',
    entityId: itemId,
    commentId: null,
    fileName,
    mimeType,
    sizeBytes,
    uploadedBy,
    visibility,
    createdAt: T0,
    bucket: bucketForOrg(orgId),
    storagePath: storagePathFor(projectId, itemId, id, fileName),
  });
  return {
    admin: {
      templates: [],
      workflows: {},
      fields: [
        {
          id: 'cf_site',
          name: 'Site',
          kind: 'select',
          options: ['Midtown', 'Decatur', 'Marietta', 'County HQ'],
          visibility: 'shared',
          position: 1,
          archivedAt: null,
          createdAt: T0,
        },
        {
          id: 'cf_cost_centre',
          name: 'Cost centre',
          kind: 'text',
          options: [],
          visibility: 'internal',
          position: 2,
          archivedAt: null,
          createdAt: T0,
        },
      ],
      fieldValues: [
        { projectId: 'p_ehr', itemId: 'wi_ehr_9', fieldId: 'cf_site', value: 'Midtown' },
        { projectId: 'p_ehr', itemId: 'wi_ehr_9', fieldId: 'cf_cost_centre', value: 'CC-4410' },
        { projectId: 'p_rvb', itemId: 'wi_rvb_2', fieldId: 'cf_site', value: 'County HQ' },
      ],
      attachments: [
        att(
          'at_ehr_1',
          'p_ehr',
          'org_peachtree',
          'wi_ehr_9',
          'progress-note-v2.pdf',
          'application/pdf',
          182000,
          'u_dev',
          'shared',
        ),
        att(
          'at_ehr_2',
          'p_ehr',
          'org_peachtree',
          'wi_ehr_12',
          'lab-vendor-contacts.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          9000,
          'u_assoc',
          'internal',
        ),
        att(
          'at_rvb_1',
          'p_rvb',
          'org_riverbend',
          'wi_rvb_2',
          'sample-site-plan.pdf',
          'application/pdf',
          450000,
          'u_rsponsor',
          'shared',
        ),
      ],
    },
  };
}
