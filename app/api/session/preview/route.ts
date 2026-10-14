import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { handle } from '@/lib/api';
import { getRealSession, previewSession } from '@/lib/session';
import { recordAudit } from '@/lib/data/audit';
import { ForbiddenError, NotFoundError } from '@/lib/data/errors';
import { requestIp } from '@/lib/export-http';
import { PREVIEW_COOKIE } from '@/lib/security/request-guard';
import { PREVIEW_MAX_AGE_S, previewStartSchema, signPreview, verifyPreview } from '@/lib/security/preview';

export const dynamic = 'force-dynamic';

/**
 * "View as client" preview (CLAUDE.md §2, KH-47). Admin only.
 * GET: the current preview, or null.
 * POST { orgId, role }: start previewing the portal as that client org and role. Audited as
 *   `preview.start`. Refused while a preview is already running (middleware: read-only).
 * DELETE: stop previewing. Audited as `preview.stop`. Always allowed, even while previewing.
 * While previewing, middleware.ts refuses every other non-GET request with 403.
 */
export const GET = () => handle(async ({ session }) => ({ impersonation: session.impersonation ?? null }));

export const POST = (req: Request) =>
  handle(async () => {
    const admin = await getRealSession('throw');
    if (admin.user.role !== 'admin') throw new ForbiddenError('Only Admins can preview the client portal.');
    const input = previewStartSchema.parse(await req.json().catch(() => ({})));
    const startedAt = new Date().toISOString();
    const preview = await previewSession(admin, input.orgId, input.role, startedAt);
    if (!preview?.impersonation)
      throw new NotFoundError('That client organization has nobody in that role to preview as.');
    await recordAudit(
      admin,
      {
        action: 'preview.start',
        entity: 'preview',
        entityId: input.orgId,
        after: { orgId: input.orgId, role: input.role, asUserId: preview.impersonation.asUserId },
      },
      requestIp(req),
    );
    const res = NextResponse.json({ impersonation: preview.impersonation });
    res.cookies.set(
      PREVIEW_COOKIE,
      signPreview({ adminId: admin.user.id, orgId: input.orgId, role: input.role, startedAt }),
      {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: new URL(req.url).protocol === 'https:',
        maxAge: PREVIEW_MAX_AGE_S,
      },
    );
    return res;
  });

export const DELETE = (req: Request) =>
  handle(async () => {
    const real = await getRealSession('throw');
    const token = (await cookies()).get(PREVIEW_COOKIE)?.value;
    const claim = verifyPreview(token, real.user.id);
    if (claim)
      await recordAudit(
        real,
        {
          action: 'preview.stop',
          entity: 'preview',
          entityId: claim.orgId,
          before: { orgId: claim.orgId, role: claim.role, startedAt: claim.startedAt },
          after: { durationS: Math.round((Date.now() - Date.parse(claim.startedAt)) / 1000) },
        },
        requestIp(req),
      );
    const res = NextResponse.json({ ok: true, stopped: Boolean(claim) });
    res.cookies.set(PREVIEW_COOKIE, '', { path: '/', httpOnly: true, sameSite: 'strict', maxAge: 0 });
    return res;
  });
