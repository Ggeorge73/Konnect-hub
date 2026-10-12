import { handle } from '@/lib/api';
import { generateDraft, listReports } from '@/lib/data/reports';
import { generateReportSchema } from '@/lib/report-schemas';

/** GET /api/reports?project=KEY: reports the caller may read (clients: published only). */
export const GET = (req: Request) =>
  handle(({ session }) =>
    listReports(session, { project: new URL(req.url).searchParams.get('project') ?? undefined }),
  );

/** POST { projectKey, weekStart? }: "Generate draft" from that week's activity. */
export const POST = (req: Request) =>
  handle(async ({ session }) => {
    const input = generateReportSchema.parse(await req.json());
    return generateDraft(session, input.projectKey, input.weekStart);
  });
