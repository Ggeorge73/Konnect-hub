import { handle } from '@/lib/api';
import { capacityStore } from '@/lib/data/capacity';

/** GET /api/people/directory: the people directory, redacted per role (clients get 403). */
export const GET = () => handle(({ session }) => capacityStore().listDirectory(session));
