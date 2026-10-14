import { NextResponse } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { getApiSession } from '@/lib/session';
import { getRepo } from '@/lib/data';
import { errorStatus } from '@/lib/data/errors';
import { isClientRole } from '@/lib/domain/permissions';
import { currentSeq, eventsSince, forViewer, subscribe, type RealtimeEvent } from '@/lib/realtime/bus';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Each stream lives for STREAM_MS, then ends; the browser's EventSource reconnects after
 * RETRY_MS and sends `Last-Event-ID`, and the events published in between are replayed.
 * Short streams survive serverless response limits and proxies that cut idle connections, and
 * let the page go network-idle between streams. Worst-case delivery stays under ~1.5 s.
 */
const STREAM_MS = 8_000;
const RETRY_MS = 1_000;

/**
 * GET /api/realtime?projectId=… — Server-Sent Events for one project (RT-01, demo/memory mode).
 * Authorised with the session's project visibility (the same check as the project bundle).
 * Client users only receive events about shared items; every payload is ids and kinds only.
 */
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  let client: boolean;
  let id: string;
  try {
    const session = await getApiSession();
    id = (await getRepo().getProjectBundle(session, projectId)).project.id;
    client = isClientRole(session.user.role);
  } catch (e) {
    unstable_rethrow(e);
    const status = errorStatus(e);
    return NextResponse.json(
      { error: status === 500 ? 'Something went wrong.' : (e as Error).message },
      { status },
    );
  }
  const lastId = Number(req.headers.get('last-event-id') ?? NaN);
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const onEvent = (e: RealtimeEvent) => {
        const out = forViewer(e, client);
        if (out) send(`id: ${out.id}\nevent: change\ndata: ${JSON.stringify(out)}\n\n`);
      };
      const unsubscribe = subscribe(id, onEvent);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const timer = setTimeout(() => cleanup(), STREAM_MS);
      req.signal.addEventListener('abort', () => cleanup());
      send(`retry: ${RETRY_MS}\n\n`);
      // Reconnection: replay what was published during the gap. Then mark "now" as the resume point.
      if (Number.isFinite(lastId)) for (const e of eventsSince(id, lastId)) onEvent(e);
      send(`id: ${currentSeq()}\nevent: ready\ndata: {}\n\n`);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
