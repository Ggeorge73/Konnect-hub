import { z } from 'zod';

/** PATCH /api/projects/[key]/dashboard: a RAG override (with reason) and/or the budget-sharing flag. */
export const dashboardPatchSchema = z
  .object({
    rag: z.enum(['green', 'amber', 'red']).optional(),
    reason: z.string().max(500, 'Keep the reason under 500 characters.').optional(),
    shareBudget: z.boolean().optional(),
  })
  .refine((v) => v.rag !== undefined || v.shareBudget !== undefined, 'Nothing to change.')
  .refine((v) => v.rag === undefined || Boolean(v.reason?.trim()), {
    message: 'A reason is required to set the RAG status.',
  });
export type DashboardPatch = z.infer<typeof dashboardPatchSchema>;
