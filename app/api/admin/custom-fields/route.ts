import { handle } from '@/lib/api';
import { customFieldStore } from '@/lib/data/custom-fields';
import { customFieldSchema } from '@/lib/domain/admin';
import { requestIp } from '@/lib/export-http';

/** POST: an Admin defines a text, number, date or select field. */
export const POST = (req: Request) =>
  handle(async ({ session }) => {
    const body = await req.json();
    customFieldSchema.parse(body);
    return customFieldStore().createField(session, body, requestIp(req));
  });
