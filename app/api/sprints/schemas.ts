import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD');

export const createSprintSchema = z
  .object({
    projectId: z.string().min(1),
    name: z.string().trim().min(1, 'Name is required').max(120),
    phaseId: z.string().min(1, 'Choose a phase'),
    startDate: isoDate,
    endDate: isoDate,
    goal: z.string().max(500).optional(),
    capacityHours: z.number().min(0, 'Capacity hours cannot be negative').nullable().optional(),
  })
  .refine((v) => v.endDate > v.startDate, {
    message: 'End date must be after the start date.',
    path: ['endDate'],
  });

export const sprintPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phaseId: z.string().min(1),
    startDate: isoDate,
    endDate: isoDate,
    goal: z.string().max(500),
    capacityHours: z.number().min(0).nullable(),
  })
  .partial();

export const completeSprintSchema = z.object({ carryOver: z.enum(['next', 'backlog']) });

export const settingsSchema = z.object({
  project: z.string().min(1),
  hoursPerPoint: z.number().positive('Hours per point must be positive').max(100),
});

export const rescheduleSchema = z.object({
  kind: z.enum(['sprint', 'epic']),
  id: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate,
});
