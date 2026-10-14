import { handle } from '@/lib/api';
import { adminStore } from '@/lib/data/admin';

/** ADM-01: every user, internal and client (Admin only). */
export const GET = () => handle(({ session }) => adminStore().listUsers(session));
