import { z } from 'zod';

const tag = z.string().trim().min(1).max(60);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Week must be YYYY-MM-DD');

/** PATCH /api/people/:id. Admins may send every field; Leads only skills and certifications. */
export const personPatchSchema = z
  .object({
    title: z.string().trim().max(120).optional(),
    skills: z.array(tag).max(40).optional(),
    certifications: z.array(tag).max(40).optional(),
    location: z.string().trim().max(120).optional(),
    timezone: z.string().trim().max(64).optional(),
    hoursPerWeek: z.number().min(0, 'Hours must be 0–80').max(80, 'Hours must be 0–80').optional(),
    usPerson: z.boolean().optional(),
    costRate: z.number().min(0).max(10_000).optional(),
  })
  .strict();

/** PUT /api/capacity/allocations: set one person's hours on one project in one ISO week. */
export const allocationSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  week: ymd,
  hours: z.number().min(0, 'Hours must be 0–80').max(80, 'Hours must be 0–80'),
});

/** POST /api/projects/:key/team: assign (or re-assign) a person with a role and allocation %. */
export const assignSchema = z.object({
  userId: z.string().min(1, 'Choose a person'),
  projectRole: z.string().trim().min(1, 'Role is required').max(80),
  allocationPct: z.number().int().min(0, 'Use 0–100%').max(100, 'Use 0–100%'),
});

export const previewSchema = assignSchema.pick({ userId: true, allocationPct: true });

export const restrictedSchema = z.object({ restricted: z.boolean() });

export type PersonPatch = z.infer<typeof personPatchSchema>;
export type AllocationInput = z.infer<typeof allocationSchema>;
export type AssignInput = z.infer<typeof assignSchema>;
