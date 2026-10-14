import { z } from 'zod';
import { AiOutputError } from './errors';

/**
 * Shapes of the model's structured outputs. Each has a zod schema (the authority: every response
 * is parsed with it, whatever the provider promised) and a JSON Schema sent as the structured
 * output format. Anything that does not parse is rejected; nothing is saved.
 */

const SECTION_IDS = ['scope', 'schedule', 'budget', 'risks', 'decisions', 'next_steps'] as const;
const CATEGORIES = [
  'schedule',
  'cost',
  'resource',
  'technical',
  'vendor',
  'regulatory',
  'reputational',
] as const;
const ITEM_TYPES = ['feature', 'story', 'task', 'bug', 'change_request'] as const;
const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
const level = z.number().int().min(1).max(5);

// --- KH-42 status report ----------------------------------------------------
export const statusDraftOutput = z.object({
  sections: z
    .array(z.object({ id: z.enum(SECTION_IDS), html: z.string().min(1).max(12_000) }))
    .min(1)
    .max(SECTION_IDS.length),
});
export type StatusDraftOutput = z.infer<typeof statusDraftOutput>;

// --- KH-43 risk suggestions -------------------------------------------------
export const riskSuggestionsOutput = z.object({
  suggestions: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        category: z.enum(CATEGORIES),
        probability: level,
        impact: level,
        mitigation: z.string().trim().min(1).max(2000),
        signalKeys: z.array(z.string().min(1).max(200)).min(1).max(20),
        linkedItemKeys: z.array(z.string().min(1).max(40)).max(20),
      }),
    )
    .max(20),
});
export type RiskSuggestionsOutput = z.infer<typeof riskSuggestionsOutput>;

// --- KH-44 meeting notes ----------------------------------------------------
export const meetingNotesOutput = z.object({
  items: z
    .array(
      z.object({
        type: z.enum(ITEM_TYPES),
        title: z.string().trim().min(1).max(255),
        description: z.string().max(4000),
        assigneeId: z.string().max(100).nullable(),
        priority: z.enum(PRIORITIES),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
      }),
    )
    .max(25),
});
export type MeetingNotesOutput = z.infer<typeof meetingNotesOutput>;

// --- KH-44 thread summary ---------------------------------------------------
export const threadSummaryOutput = z.object({
  summary: z.string().trim().min(1).max(2000),
  keyPoints: z.array(z.string().trim().min(1).max(300)).max(8),
});
export type ThreadSummaryOutput = z.infer<typeof threadSummaryOutput>;

// --- JSON Schemas for structured outputs ------------------------------------
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const str = { type: 'string' };
const nullableStr = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const int = { type: 'integer' };
const arr = (items: unknown) => ({ type: 'array', items });
const enumOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });

export const JSON_SCHEMAS = {
  status_report: obj({ sections: arr(obj({ id: enumOf(SECTION_IDS), html: str })) }),
  risk_suggestions: obj({
    suggestions: arr(
      obj({
        title: str,
        category: enumOf(CATEGORIES),
        probability: int,
        impact: int,
        mitigation: str,
        signalKeys: arr(str),
        linkedItemKeys: arr(str),
      }),
    ),
  }),
  meeting_notes: obj({
    items: arr(
      obj({
        type: enumOf(ITEM_TYPES),
        title: str,
        description: str,
        assigneeId: nullableStr,
        priority: enumOf(PRIORITIES),
        dueDate: nullableStr,
      }),
    ),
  }),
  thread_summary: obj({ summary: str, keyPoints: arr(str) }),
} satisfies Record<string, Record<string, unknown>>;

/**
 * Parses model output as JSON and validates it. Tolerates a ```json fence around the object; any
 * other deviation (prose, truncated JSON, wrong fields) throws AiOutputError.
 */
export function parseModelJson<T>(text: string, schema: z.ZodType<T>): T {
  let raw = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
  if (fence) raw = fence[1];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AiOutputError('not valid JSON');
  }
  const res = schema.safeParse(value);
  if (!res.success) throw new AiOutputError('unexpected shape');
  return res.data;
}
