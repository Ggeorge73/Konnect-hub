import { handle } from '@/lib/api';
import { updateWorkspace } from '@/lib/data/onboarding';
import { workspaceSchema } from '@/lib/domain/onboarding';

export const PUT = (req: Request) =>
  handle(async ({ session }) => updateWorkspace(session, workspaceSchema.parse(await req.json())));
