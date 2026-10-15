import { notFound } from 'next/navigation';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/session';
import { getGates } from '@/lib/data/gates';
import { listDeliverables } from '@/lib/data/deliverables';
import { canDecideDeliverable } from '@/lib/domain/deliverables';
import { PortalProject } from '@/features/portal/PortalProject';
import { listRaid } from '@/lib/data/raid';
import { PortalGatesSection } from '@/features/gates/PortalGatesSection';
import { PortalDashboardLink } from '@/features/insight/PortalDashboardLink';
import { listReports } from '@/lib/data/reports';
import { NotFoundError } from '@/lib/data/errors';
import { buildMilestones, canSubmitRequest } from '@/lib/domain/portal';
import { listItems } from '@/lib/integration/service';
import { ForYourReview } from '@/features/portal/ForYourReview';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const s = await getSession();
  const repo = getRepo();
  // Another client's project (or an unknown key) is a plain 404, never a hint that it exists.
  const bundle = await repo.getProjectBundle(s, key.toUpperCase()).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (bundle.project.deletedAt) notFound();
  const [items, gates, deliverables, raid, reports, projects, review] = await Promise.all([
    repo.listItems(s, { projectId: bundle.project.id }),
    getGates(s, bundle.project.key),
    listDeliverables(s, bundle.project.key),
    listRaid(s, { projectId: bundle.project.id }),
    listReports(s, { project: bundle.project.key }),
    repo.listProjects(s),
    listItems(s, bundle.project.key),
  ]);
  const milestones = buildMilestones(
    { sprints: bundle.sprints, phases: bundle.phases, deliverables },
    new Date().toISOString().slice(0, 10),
  ).slice(0, 10);
  return (
    <PortalProject
      bundle={bundle}
      items={items}
      raid={raid}
      reports={reports}
      milestones={milestones}
      rag={projects.find((p) => p.id === bundle.project.id)?.rag}
      canRequest={canSubmitRequest(s.user.role)}
      overview={<PortalDashboardLink projectKey={bundle.project.key} />}
      review={<ForYourReview items={review} />}
      approvals={
        <PortalGatesSection
          projectKey={bundle.project.key}
          gates={gates}
          deliverables={deliverables}
          canDecideDeliverables={canDecideDeliverable(s.user, bundle.project)}
          canDownloadRecord={s.user.role === 'client_sponsor'}
        />
      }
    />
  );
}
