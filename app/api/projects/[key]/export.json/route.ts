import { handleFile, requestIp } from '@/lib/export-http';
import { buildProjectExport } from '@/lib/data/project-export';
import { isoDay } from '@/lib/data/insight';

export const dynamic = 'force-dynamic';

/** Full project JSON export (Admin or the project's Lead). Audited as export.json. */
export const GET = (req: Request, { params }: { params: Promise<{ key: string }> }) =>
  handleFile(async (session) => {
    const data = await buildProjectExport(session, (await params).key, requestIp(req));
    return {
      body: JSON.stringify(data, null, 2),
      contentType: 'application/json; charset=utf-8',
      filename: `${data.project.key}-project-${isoDay(new Date())}.json`,
    };
  });
