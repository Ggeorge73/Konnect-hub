import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/session';
import { MyWork } from '@/features/search/MyWork';

export const metadata = { title: 'My Work' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const s = await getSession();
  const repo = getRepo();
  const [items, projects] = await Promise.all([
    repo.listItems(s, { assigneeId: [s.user.id] }),
    repo.listProjects(s),
  ]);
  const keyOf = Object.fromEntries(projects.map((p) => [p.id, p.key]));
  return (
    <MyWork
      items={items
        .filter((i) => i.status !== 'accepted' && i.status !== 'done')
        .map((i) => ({ ...i, projectKey: keyOf[i.projectId] }))}
    />
  );
}
