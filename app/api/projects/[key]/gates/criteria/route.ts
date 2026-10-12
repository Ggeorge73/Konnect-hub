import { handle } from '@/lib/api';
import { addCriterion } from '@/lib/data/gates';
import { criterionCreateSchema } from '@/lib/gate-schemas';

export const POST = (req: Request, { params }: { params: Promise<{ key: string }> }) =>
  handle(async ({ session }) => {
    const { phaseId, text } = criterionCreateSchema.parse(await req.json());
    return addCriterion(session, (await params).key, phaseId, text);
  });
