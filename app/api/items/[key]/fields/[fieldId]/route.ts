import { handle } from '@/lib/api';
import { customFieldStore } from '@/lib/data/custom-fields';
import { fieldValueSchema } from '@/lib/domain/admin';

type Ctx = { params: Promise<{ key: string; fieldId: string }> };

/** PUT { value }: sets (or with null / '' clears) one custom field value on the item. */
export const PUT = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) => {
    const { key, fieldId } = await params;
    const { value } = fieldValueSchema.parse(await req.json());
    return customFieldStore().setItemValue(session, key, fieldId, value);
  });
