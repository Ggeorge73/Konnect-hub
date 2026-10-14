import 'server-only';
import { NextResponse } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';
import { errorStatus } from './data/errors';
import { getSession } from './session';
import { clientIp } from './domain/gates';
import type { Session } from './domain/types';

/** The caller's IP for the audit entry (first X-Forwarded-For hop, else X-Real-IP). */
export const requestIp = (req: Request) =>
  clientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'));

/**
 * Like handle() in lib/api.ts, for routes that return a file download: resolves the session,
 * maps domain errors to JSON errors with the right status, and never caches the response.
 */
export async function handleFile(
  fn: (session: Session) => Promise<{ body: Buffer | string; contentType: string; filename: string }>,
) {
  try {
    const f = await fn(await getSession());
    return new NextResponse(typeof f.body === 'string' ? f.body : new Uint8Array(f.body), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ZodError)
      return NextResponse.json({ error: e.issues.map((i) => i.message).join('; ') }, { status: 400 });
    const status = errorStatus(e);
    if (status === 500) console.error(e);
    return NextResponse.json(
      { error: status === 500 ? 'Something went wrong.' : (e as Error).message },
      { status },
    );
  }
}
