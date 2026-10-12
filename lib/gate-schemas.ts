import { z } from 'zod';

/** Request schemas for the gates, deliverables and re-auth endpoints. */
export const criterionCreateSchema = z.object({
  phaseId: z.string().min(1),
  text: z.string().trim().min(1, 'Criterion text is required').max(500),
});
export const criterionPatchSchema = z
  .object({ text: z.string().trim().min(1).max(500), done: z.boolean() })
  .partial();

export const requestReviewSchema = z.object({
  phaseId: z.string().min(1),
  overrideNote: z.string().max(2000).optional(),
  summary: z.string().max(4000).optional(),
  shareBudget: z.boolean().optional(),
});

export const decisionSchema = z.object({
  decision: z.enum(['approved', 'approved_with_conditions', 'rejected']),
  conditions: z.array(z.string().max(500)).max(20).optional(),
  reason: z.string().max(4000).optional(),
});

export const reauthSchema = z.object({ email: z.string().trim().min(3).max(320) });

const visibility = z.enum(['internal', 'shared']);
export const deliverableCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().max(4000).optional(),
  phaseId: z.string().nullable().optional(),
  ownerId: z.string().min(1, 'Choose an owner'),
  dueDate: z.string().nullable().optional(),
  visibility,
  itemIds: z.array(z.string()).max(200).default([]),
  criteria: z.array(z.string().max(500)).max(50).default([]),
});
export const deliverablePatchSchema = deliverableCreateSchema.partial();

export const criterionDecisionSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
  note: z.string().max(2000).optional(),
});
