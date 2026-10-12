import { handle } from '@/lib/api';
import { updateDeliverable } from '@/lib/data/deliverables';
import { deliverablePatchSchema } from '@/lib/gate-schemas';

export const PATCH = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async ({ session }) =>
    updateDeliverable(session, (await params).id, deliverablePatchSchema.parse(await req.json())),
  );
