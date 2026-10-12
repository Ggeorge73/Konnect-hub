import { handle } from '@/lib/api';
import { createProjectSchema } from '@/lib/schemas';

export const GET = () => handle(({ session, repo }) => repo.listProjects(session));
export const POST = (req: Request) =>
  handle(async ({ session, repo }) =>
    repo.createProject(session, createProjectSchema.parse(await req.json())),
  );
