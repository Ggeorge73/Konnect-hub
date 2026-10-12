import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { errorStatus } from '@/lib/data/errors';
import { getDashboard, recordDashboardExport } from '@/lib/data/insight';
import { clientIp } from '@/lib/domain/gates';
import { renderDashboardPdf } from '@/lib/pdf/dashboard';

export const dynamic = 'force-dynamic';

/** DASH-01: one-page PDF of the executive dashboard, redacted for the viewer. Every export is audited. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const session = await getSession();
    const view = await getDashboard(session, (await params).key);
    const bytes = await renderDashboardPdf(view, session.user.name);
    recordDashboardExport(
      session,
      view.projectId,
      view.evmAccess,
      clientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip')),
    );
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${view.projectKey}-dashboard-${view.asOf}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    const status = errorStatus(e);
    if (status === 500) console.error(e);
    return NextResponse.json(
      { error: status === 500 ? 'Something went wrong.' : (e as Error).message },
      { status },
    );
  }
}
