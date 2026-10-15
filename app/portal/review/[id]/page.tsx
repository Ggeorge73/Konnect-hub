import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getRepo } from '@/lib/data';
import { NotFoundError } from '@/lib/data/errors';
import { actionBlocker } from '@/lib/domain/crm';
import { openItem } from '@/lib/integration/service';
import { ReviewItem } from '@/features/portal/ReviewItem';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'For your review' };

/** One commercial item. Opening it is the "viewed" signal the CRM receives (first open only). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const id = decodeURIComponent((await params).id);
  // Another organization's item (or an unknown id) is a plain 404, never a hint that it exists.
  const item = await openItem(s, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const projects = item.projectId ? await getRepo().listProjects(s) : [];
  return (
    <ReviewItem
      item={item}
      blocker={actionBlocker(s.user.role, item)}
      projectName={projects.find((p) => p.id === item.projectId)?.name ?? null}
      userName={s.user.name}
    />
  );
}
