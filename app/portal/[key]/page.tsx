import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/session';
import { PortalProject } from '@/features/portal/PortalProject';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const s = await getSession();
  const repo = getRepo();
  const bundle = await repo.getProjectBundle(s, key.toUpperCase());
  const items = await repo.listItems(s, { projectId: bundle.project.id });
  return <PortalProject bundle={bundle} items={items} />;
}
