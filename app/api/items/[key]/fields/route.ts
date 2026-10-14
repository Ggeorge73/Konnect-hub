import { handle } from '@/lib/api';
import { customFieldStore } from '@/lib/data/custom-fields';

type Ctx = { params: Promise<{ key: string }> };

/** GET: fieldId -> value for the custom fields the caller may see on this item. */
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => customFieldStore().getItemValues(session, (await params).key));
