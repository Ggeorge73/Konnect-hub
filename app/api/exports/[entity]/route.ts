import { handleFile, requestIp } from '@/lib/export-http';
import { EXPORT_ENTITIES, runExport, type ExportEntity } from '@/lib/data/exports';
import { isExportFormat } from '@/lib/export';
import { NotFoundError, ValidationError } from '@/lib/data/errors';

export const dynamic = 'force-dynamic';

/**
 * EXP-01: CSV / Excel download of a list view (?format=csv|xlsx plus the view's filters).
 * Entities: items, raid, portfolio, timesheet, time (approved time), audit. Every export is audited.
 */
export const GET = (req: Request, { params }: { params: Promise<{ entity: string }> }) =>
  handleFile(async (session) => {
    const entity = (await params).entity as ExportEntity;
    if (!EXPORT_ENTITIES.includes(entity)) throw new NotFoundError('Unknown export');
    const sp = new URL(req.url).searchParams;
    const format = sp.get('format') ?? 'csv';
    if (!isExportFormat(format)) throw new ValidationError('Format must be csv or xlsx.');
    return runExport(session, entity, format, sp, requestIp(req));
  });
