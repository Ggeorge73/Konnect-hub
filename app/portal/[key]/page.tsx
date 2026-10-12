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

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const s = await getSession();
  const repo = getRepo();
  const bundle = await repo.getProjectBundle(s, key.toUpperCase());
  const items = await repo.listItems(s, { projectId: bundle.project.id });
  const [gates, deliverables, raid, reports] = await Promise.all([
    getGates(s, bundle.project.key),
    listDeliverables(s, bundle.project.key),
    listRaid(s, { projectId: bundle.project.id }),
    listReports(s, { project: bundle.project.key }),
  ]);
  return (
    <PortalProject bundle={bundle} items={items} raid={raid} reports={reports}>
      <PortalDashboardLink projectKey={bundle.project.key} />
      <PortalGatesSection
        projectKey={bundle.project.key}
        gates={gates}
        deliverables={deliverables}
        canDecideDeliverables={canDecideDeliverable(s.user, bundle.project)}
        canDownloadRecord={s.user.role === 'client_sponsor'}
      />
    </PortalProject>
  );
}
