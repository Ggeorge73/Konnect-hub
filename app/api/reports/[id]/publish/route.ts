import { handle } from '@/lib/api';
import { publishCheck, publishReport } from '@/lib/data/reports';
import { publishReportSchema } from '@/lib/report-schemas';

type Ctx = { params: Promise<{ id: string }> };

/** GET ?shareBudget=1: the pre-publish checklist (what the client copy leaves out). */
export const GET = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    publishCheck(session, (await params).id, new URL(req.url).searchParams.get('shareBudget') === '1'),
  );

/** POST { shareBudget? }: publish to the client portal. Leads and Admins only (403 otherwise). */
export const POST = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) => {
    const body = publishReportSchema.parse(await req.json().catch(() => ({})));
    return publishReport(session, (await params).id, body);
  });
