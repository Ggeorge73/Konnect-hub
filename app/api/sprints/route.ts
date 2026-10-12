import { handle } from '@/lib/api';
import { createSprint, listSprints } from '@/lib/data/sprints';
import { ValidationError } from '@/lib/data/errors';
import { createSprintSchema } from './schemas';

export const GET = (req: Request) =>
  handle(async ({ session }) => {
    const project = new URL(req.url).searchParams.get('project');
    if (!project) throw new ValidationError('project is required');
    return listSprints(session, project);
  });

export const POST = (req: Request) =>
  handle(async ({ session }) => createSprint(session, createSprintSchema.parse(await req.json())));
