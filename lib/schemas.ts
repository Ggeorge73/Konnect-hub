import { z } from 'zod';

const itemType = z.enum(['epic', 'feature', 'story', 'task', 'bug', 'change_request', 'client_request']);
const itemStatus = z.enum([
  'backlog',
  'ready',
  'in_progress',
  'in_review',
  'client_review',
  'done',
  'accepted',
]);
const priority = z.enum(['critical', 'high', 'medium', 'low']);
const visibility = z.enum(['internal', 'shared']);

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(3, 'Name needs at least 3 characters'),
    key: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Key: 2–10 letters/digits starting with a letter'),
    clientOrgId: z.string().min(1, 'Choose a client'),
    leadId: z.string().min(1, 'Choose a lead'),
    startDate: z.string().min(1, 'Start date required'),
    targetDate: z.string().min(1, 'Target date required'),
    methodology: z.enum(['hybrid', 'scrum', 'kanban', 'waterfall']),
    contractType: z.enum(['fixed_fee', 'time_materials', 'retainer']),
    bac: z.coerce.number().min(0, 'Budget cannot be negative'),
    description: z.string().default(''),
    templateId: z.string().default('kdf-hybrid'),
    restricted: z.boolean().optional(),
  })
  .refine((v) => v.targetDate >= v.startDate, {
    message: 'Target date must be after start',
    path: ['targetDate'],
  });

export const createItemSchema = z.object({
  projectId: z.string().min(1),
  type: itemType,
  title: z.string().trim().min(1, 'Title is required').max(255),
  description: z.string().optional(),
  status: itemStatus.optional(),
  priority: priority.optional(),
  assigneeId: z.string().nullable().optional(),
  phaseId: z.string().nullable().optional(),
  sprintId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  estimate: z.number().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  visibility: visibility.optional(),
});

export const itemPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    description: z.string(),
    type: itemType,
    status: itemStatus,
    priority,
    assigneeId: z.string().nullable(),
    phaseId: z.string().nullable(),
    sprintId: z.string().nullable(),
    parentId: z.string().nullable(),
    estimate: z.number().nullable(),
    dueDate: z.string().nullable(),
    labels: z.array(z.string()),
    visibility,
    position: z.number(),
    offlineAcceptanceNote: z.string(),
    acceptanceCriteria: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        status: z.enum(['pending', 'accepted', 'rejected']),
        decidedBy: z.string().optional(),
        decidedAt: z.string().optional(),
        note: z.string().optional(),
      }),
    ),
  })
  .partial();

export const bulkSchema = z.object({ ids: z.array(z.string()).min(1), patch: itemPatchSchema });
export const commentSchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty'),
  visibility,
});
