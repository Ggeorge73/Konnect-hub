import { handle } from '@/lib/api';
import { listAwaitingAcceptance } from '@/lib/data/deliverables';

export const GET = () => handle(async ({ session }) => listAwaitingAcceptance(session));
