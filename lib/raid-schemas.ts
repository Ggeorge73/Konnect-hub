import { z } from 'zod';

const level = z.number().int().min(1, 'Use 1–5').max(5, 'Use 1–5');
const optText = z.string().nullable().optional();

const fields = {
  title: z.string().trim().min(1, 'Title is required').max(255),
  description: z.string().max(10_000).optional(),
  ownerId: z.string().nullable().optional(),
  status: z.enum(['open', 'in_progress', 'closed']).optional(),
  visibility: z.enum(['internal', 'shared']).optional(),
  category: z
    .enum(['schedule', 'cost', 'resource', 'technical', 'vendor', 'regulatory', 'reputational'])
    .nullable()
    .optional(),
  probability: level.nullable().optional(),
  impact: level.nullable().optional(),
  residualProbability: level.nullable().optional(),
  residualImpact: level.nullable().optional(),
  mitigation: optText,
  roam: z.enum(['resolved', 'owned', 'accepted', 'mitigated']).nullable().optional(),
  closureNote: optText,
  severity: z.enum(['critical', 'major', 'minor']).nullable().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .nullable()
    .optional(),
  decidedBy: optText,
  rationale: optText,
  linkedItemIds: z.array(z.string()).max(100).optional(),
};

export const createRaidSchema = z.object({
  projectId: z.string().min(1),
  kind: z.enum(['risk', 'assumption', 'issue', 'dependency', 'decision']),
  ...fields,
});

export const raidPatchSchema = z.object(fields).partial().strict();

export const markReadSchema = z.object({ ids: z.array(z.string()).optional() });

export type CreateRaidInput = z.infer<typeof createRaidSchema>;
export type RaidPatch = z.infer<typeof raidPatchSchema>;
