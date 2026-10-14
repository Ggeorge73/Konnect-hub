import { handle } from '@/lib/api';
import { getApprovalInbox } from '@/lib/data/portal';

/** The signed-in client's "Needs your approval" inbox (empty for staff and viewers). */
export const GET = () => handle(({ session }) => getApprovalInbox(session));
