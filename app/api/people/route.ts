import { handle } from '@/lib/api';
export const GET = () => handle(({ session, repo }) => repo.listPeople(session));
