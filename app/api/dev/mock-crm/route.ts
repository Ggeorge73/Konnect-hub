import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSupabaseConfigured } from '@/lib/config';
import { mockCrm, samples } from '@/lib/integration/mock-crm';
import { receive } from '@/lib/integration/service';

export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

/** GET /api/dev/mock-crm — demo mode only: what the mock CRM received from the Hub, newest first. */
export async function GET() {
  if (isSupabaseConfigured()) return notFound();
  return NextResponse.json([...mockCrm.received()].reverse());
}

const simulate = z.discriminatedUnion('action', [
  z.object({ action: z.literal('handoff'), name: z.string().optional(), account: z.string().optional() }),
  z.object({
    action: z.literal('publish'),
    clientId: z.string(),
    projectId: z.string().nullable().optional(),
    id: z.string().optional(),
    lineage: z.string().optional(),
    version: z.number().int().positive().optional(),
    type: z.enum(['quote', 'contract_amendment', 'renewal_offer', 'survey']).optional(),
    title: z.string().optional(),
    requiresSignature: z.boolean().optional(),
  }),
  z.object({ action: z.literal('withdraw'), itemId: z.string(), version: z.number().int().optional() }),
  z.object({
    action: z.literal('extend'),
    projectId: z.string(),
    newEndDate: z.string().nullable().optional(),
    additionalValue: z.number().nullable().optional(),
  }),
  z.object({ action: z.literal('reset') }),
  z.object({ action: z.literal('failNext'), n: z.number().int().min(0) }),
  /** Any raw payload, signed as the CRM would sign it (e.g. to test contract rejection). */
  z.object({ action: z.literal('raw'), payload: z.record(z.unknown()) }),
]);

/**
 * POST /api/dev/mock-crm — demo mode only: sends a signed CRM → Hub event through the real
 * inbound endpoint logic, or controls the mock (reset, failNext).
 */
export async function POST(req: Request) {
  if (isSupabaseConfigured()) return notFound();
  const parsed = simulate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Unknown simulation.' }, { status: 400 });
  const a = parsed.data;
  if (a.action === 'reset') {
    mockCrm.reset();
    return NextResponse.json({ ok: true });
  }
  if (a.action === 'failNext') {
    mockCrm.failNext(a.n);
    return NextResponse.json({ ok: true });
  }
  const payload =
    a.action === 'handoff'
      ? samples.handoff({ name: a.name, account: a.account })
      : a.action === 'publish'
        ? samples.publish(a.clientId, a.projectId ?? null, a)
        : a.action === 'withdraw'
          ? samples.withdraw(a.itemId, a.version)
          : a.action === 'extend'
            ? samples.extend(a.projectId, a.newEndDate ?? null, a.additionalValue ?? null)
            : a.payload;
  const { body, signature } = mockCrm.signed(payload);
  const r = await receive(body, signature);
  return NextResponse.json({ sent: payload, ...r }, { status: r.status });
}
