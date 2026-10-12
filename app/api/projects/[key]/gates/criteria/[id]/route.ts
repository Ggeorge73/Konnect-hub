import { handle } from '@/lib/api';
import { removeCriterion, updateCriterion } from '@/lib/data/gates';
import { criterionPatchSchema } from '@/lib/gate-schemas';

type Ctx = { params: Promise<{ key: string; id: string }> };
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) => {
    const { key, id } = await params;
    return updateCriterion(session, key, id, criterionPatchSchema.parse(await req.json()));
  });
export const DELETE = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => {
    const { key, id } = await params;
    return removeCriterion(session, key, id);
  });
