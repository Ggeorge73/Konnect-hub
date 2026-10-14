import { z } from 'zod';
import { hoursError, isIsoDate } from './domain/ledger';

/** Request bodies for time tracking (KH-37) and the audit viewer (KH-38). */
const date = z.string().refine(isIsoDate, 'Enter a valid date (YYYY-MM-DD).');
const hours = z.number().refine((h) => hoursError(h) === null, {
  message: 'Hours must be more than 0, at most 24, in 0.25 steps.',
});

export const logTimeSchema = z.object({
  itemId: z.string().min(1),
  date,
  hours,
  billable: z.boolean().optional(),
  note: z.string().max(2000).optional(),
});

export const timePatchSchema = z
  .object({
    date: date.optional(),
    hours: hours.optional(),
    billable: z.boolean().optional(),
    note: z.string().max(2000).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change.');

export const submitWeekSchema = z.object({ week: date });

export const decideTimeSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(500),
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().max(2000).optional(),
  })
  .refine((d) => d.decision === 'approved' || Boolean(d.reason?.trim()), {
    message: 'A reason is required to reject time.',
    path: ['reason'],
  });

export const auditQuerySchema = z.object({
  actor: z.string().optional(),
  action: z.string().max(100).optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
