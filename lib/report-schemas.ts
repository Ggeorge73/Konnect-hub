import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const html = z.string().max(50_000);

/** POST /api/reports: generate (or reopen) the draft for a project's week. */
export const generateReportSchema = z.object({
  projectKey: z.string().trim().min(1, 'Choose a project'),
  weekStart: day.optional(),
});

/** PATCH /api/reports/[id]: edit a draft's sections or RAG. */
export const reportPatchSchema = z.object({
  sections: z
    .object({
      scope: html.optional(),
      schedule: html.optional(),
      budget: html.optional(),
      risks: html.optional(),
      decisions: html.optional(),
      next_steps: html.optional(),
    })
    .strict()
    .optional(),
  rag: z.enum(['green', 'amber', 'red']).optional(),
  ragReason: z.string().max(500).optional(),
});

/** POST /api/reports/[id]/publish. */
export const publishReportSchema = z.object({ shareBudget: z.boolean().optional() });
