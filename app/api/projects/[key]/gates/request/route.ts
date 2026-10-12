import { handle } from '@/lib/api';
import { requestReview } from '@/lib/data/gates';
import { requestReviewSchema } from '@/lib/gate-schemas';

export const POST = (req: Request, { params }: { params: Promise<{ key: string }> }) =>
  handle(async ({ session }) =>
    requestReview(session, (await params).key, requestReviewSchema.parse(await req.json())),
  );
