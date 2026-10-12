import { handle } from '@/lib/api';
import { getPortfolio } from '@/lib/data/insight';

/** DASH-02 portfolio rows. 403 for Associates and client users. */
export const GET = () => handle(async ({ session }) => getPortfolio(session));
