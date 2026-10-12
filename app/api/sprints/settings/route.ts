import { handle } from '@/lib/api';
import { setHoursPerPoint } from '@/lib/data/sprints';
import { settingsSchema } from '../schemas';

export const PUT = (req: Request) =>
  handle(async ({ session }) => {
    const { project, hoursPerPoint } = settingsSchema.parse(await req.json());
    return setHoursPerPoint(session, project, hoursPerPoint);
  });
