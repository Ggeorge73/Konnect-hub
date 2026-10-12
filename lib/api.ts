import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { errorStatus } from './data/errors';
import { getSession } from './session';
import { getRepo } from './data';
import type { Session } from './domain/types';
import type { Repo } from './data/repo';

type Handler = (ctx: { session: Session; repo: Repo }) => Promise<unknown>;

/** Wraps a route handler: resolves the session and repo, maps domain errors to HTTP codes. */
export async function handle(fn: Handler) {
  try {
    const session = await getSession();
    const data = await fn({ session, repo: getRepo() });
    return NextResponse.json(data ?? { ok: true });
  } catch (e) {
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
