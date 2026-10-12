import { handle } from '@/lib/api';
import { getReport, updateReport } from '@/lib/data/reports';
import { reportPatchSchema } from '@/lib/report-schemas';

type Ctx = { params: Promise<{ id: string }> };
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => getReport(session, (await params).id));
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    updateReport(session, (await params).id, reportPatchSchema.parse(await req.json())),
  );
