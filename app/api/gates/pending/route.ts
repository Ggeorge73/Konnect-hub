import { handle } from '@/lib/api';
import { listPendingReviews } from '@/lib/data/gates';

export const GET = () => handle(async ({ session }) => listPendingReviews(session));
