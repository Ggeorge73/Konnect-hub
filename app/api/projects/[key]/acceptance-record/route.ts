import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { errorStatus } from '@/lib/data/errors';
import { buildAcceptanceRecord } from '@/lib/data/acceptance-record';
import { renderAcceptanceRecord } from '@/lib/pdf/acceptance-record';

export const dynamic = 'force-dynamic';

/** PDF-01: Konnector-branded Acceptance Record. Every export is audited. */
export async function GET(_: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const record = await buildAcceptanceRecord(await getSession(), (await params).key);
    const bytes = await renderAcceptanceRecord(record);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${record.projectKey}-acceptance-record.pdf"`,
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
