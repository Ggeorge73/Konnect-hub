import { z } from 'zod';
import { MAX_LOOKAHEAD_DAYS } from './domain/ai';

/** Request bodies of the AI assist routes (app/api/ai/...). */

export const aiToggleSchema = z.object({ enabled: z.boolean() }).strict();

export const riskSuggestSchema = z
  .object({ lookaheadDays: z.number().int().min(0).max(MAX_LOOKAHEAD_DAYS).optional() })
  .strict();

const signalKeys = z.array(z.string().min(1).max(200)).min(1, 'No signals given').max(20);

export const acceptRiskSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(255),
    category: z.enum(['schedule', 'cost', 'resource', 'technical', 'vendor', 'regulatory', 'reputational']),
    probability: z.number().int().min(1, 'Use 1–5').max(5, 'Use 1–5'),
    impact: z.number().int().min(1, 'Use 1–5').max(5, 'Use 1–5'),
    mitigation: z.string().trim().max(2000),
    signalKeys,
    linkedItemKeys: z.array(z.string().min(1).max(40)).max(20),
  })
  .strict();

export const dismissRiskSchema = z.object({ signalKeys }).strict();

export const meetingNotesSchema = z
  .object({
    notes: z.string().trim().min(1, 'Paste some meeting notes first').max(50_000, 'Notes are too long'),
  })
  .strict();

export const proposedItemSchema = z
  .object({
    type: z.enum(['feature', 'story', 'task', 'bug', 'change_request']),
    title: z.string().trim().min(1, 'Every item needs a title').max(255),
    description: z.string().max(4000),
    assigneeId: z.string().max(100).nullable(),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD')
      .nullable(),
  })
  .strict();

export const createFromNotesSchema = z
  .object({ items: z.array(proposedItemSchema).min(1, 'Tick at least one item').max(25) })
  .strict();
