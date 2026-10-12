import { NextResponse } from 'next/server';
import { calendarFeed } from '@/lib/data/calendar';
import { getRepo } from '@/lib/data';
import { verifyCalendarToken } from '@/lib/ics/token';
import { sessionForUserId } from '@/lib/ics/session';

export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Calendar not found' }, { status: 404 });

/**
 * GET /api/projects/:key/calendar.ics?token=… — the subscriber's iCalendar milestone feed.
 * No cookies: the token names the user, is checked against the project, and the feed is built
 * with that user's visibility. Any failure is a plain 404 so tokens cannot be probed.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const token = new URL(req.url).searchParams.get('token');
  const userId = token ? Buffer.from(token.split('.')[0] ?? '', 'base64url').toString() : '';
  try {
    const s = userId ? await sessionForUserId(userId) : null;
    if (!s) return notFound();
    const { project } = await getRepo().getProjectBundle(s, key);
    if (verifyCalendarToken(token, project.id) !== s.user.id) return notFound();
    const body = await calendarFeed(s, project.key);
    return new NextResponse(body, {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': `inline; filename="${project.key.toLowerCase()}-milestones.ics"`,
        'cache-control': 'private, max-age=300',
      },
    });
  } catch {
    return notFound();
  }
}
