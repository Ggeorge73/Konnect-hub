import { handle } from '@/lib/api';
import { reportGrid } from '@/lib/data/reports';

/** GET: projects × the last four reporting weeks, for the internal Reports page. */
export const GET = () => handle(({ session }) => reportGrid(session));
