import { handle } from '@/lib/api';
import { customFieldStore } from '@/lib/data/custom-fields';
import { customFieldPatchSchema } from '@/lib/domain/admin';
import { requestIp } from '@/lib/export-http';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { name?, options?, visibility?, archived? }: the kind never changes. */
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    customFieldStore().updateField(
      session,
      (await params).id,
      customFieldPatchSchema.parse(await req.json()),
      requestIp(req),
    ),
  );
