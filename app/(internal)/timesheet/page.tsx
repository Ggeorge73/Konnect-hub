import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/session';
import { isoDay } from '@/lib/data/insight';
import { isoWeekStart } from '@/lib/domain/ledger';
import { Timesheet } from '@/features/ledger/Timesheet';

export const metadata = { title: 'Timesheet' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const s = await getSession();
  const repo = getRepo();
  // Items the user can log time on: every visible item of their projects (associates: assigned only).
  const [items, projects] = await Promise.all([repo.listItems(s, {}), repo.listProjects(s)]);
  const keyOf = Object.fromEntries(projects.map((p) => [p.id, p.key]));
  const loggable = items
    .filter((i) => keyOf[i.projectId] && i.type !== 'epic')
    .map((i) => ({ id: i.id, key: i.key, title: i.title, projectKey: keyOf[i.projectId] }))
    .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  return (
    <Timesheet
      items={loggable}
      canApprove={s.user.role === 'admin' || s.user.role === 'delivery_lead'}
      initialWeek={isoWeekStart(isoDay(new Date()))}
    />
  );
}
