import { handle } from '@/lib/api';
import { customFieldStore } from '@/lib/data/custom-fields';

type Ctx = { params: Promise<{ key: string }> };

/** GET: itemId -> { fieldId: value } for the list view's custom columns. */
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => customFieldStore().listProjectValues(session, (await params).key));
