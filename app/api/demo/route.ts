import { handle } from '@/lib/api';
export const DELETE = () => handle(({ session, repo }) => repo.deleteDemoProject(session));
