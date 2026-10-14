import { handle } from '@/lib/api';
import { deleteTime, updateTime } from '@/lib/data/ledger';
import { timePatchSchema } from '@/lib/ledger-schemas';

type Ctx = { params: Promise<{ id: string }> };

/** Edit an own draft or rejected entry (editing a rejected entry makes it a draft again). */
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    updateTime(session, (await params).id, timePatchSchema.parse(await req.json())),
  );

/** Delete an own draft or rejected entry. Approved time is locked. */
export const DELETE = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => {
    await deleteTime(session, (await params).id);
    return { ok: true };
  });
