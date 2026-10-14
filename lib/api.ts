import 'server-only';
import { NextResponse } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';
import { errorStatus } from './data/errors';
import { getApiSession } from './session';
import { getRepo } from './data';
import type { Session } from './domain/types';
import type { Repo } from './data/repo';

type Handler = (ctx: { session: Session; repo: Repo }) => Promise<unknown>;

/**
 * Wraps a route handler: resolves the session (401 JSON when there is none, never a redirect),
 * passes the repo, validates nothing itself (handlers parse their input with zod) and maps domain
 * errors to HTTP codes. CSRF, rate limits and the read-only preview are enforced earlier, in
 * middleware.ts.
 */
export async function handle(fn: Handler) {
  try {
    const session = await getApiSession();
    const data = await fn({ session, repo: getRepo() });
    // A handler may build its own response (cookies, status codes); pass it through untouched.
    if (data instanceof Response) return data;
    return NextResponse.json(data ?? { ok: true });
  } catch (e) {
    // Let auth redirects from getApiSession() (sign-in, MFA) through.
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
