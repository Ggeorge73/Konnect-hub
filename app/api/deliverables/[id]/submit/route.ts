import { handle } from '@/lib/api';
import { submitDeliverable } from '@/lib/data/deliverables';

export const POST = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async ({ session }) => submitDeliverable(session, (await params).id));
