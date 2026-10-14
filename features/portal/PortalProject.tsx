'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Chip,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import type { ProjectBundle } from '@/lib/data/repo';
import type { WorkItem } from '@/lib/domain/types';
import { GateTracker } from '@/components/ui/GateTracker';
import { EmptyState, ItemKey, TypeIcon } from '@/components/ui/bits';
import { STATUS_LABEL } from '@/lib/domain/workflow';
import { ItemPanel } from '@/features/items/ItemPanel';
import { ProjectBundleProvider } from '@/features/projects/ProjectFrame';
import { SharedRaid } from '@/features/raid/SharedRaid';
import type { RaidView } from '@/lib/domain/raid';
import { PortalReportsSection } from '@/features/reports/PortalReports';
import type { ReportSummary } from '@/lib/data/reports';
import { ExportMenu } from '@/features/exports/ExportMenu';

export function PortalProject({
  bundle,
  items,
  raid = [],
  reports = [],
  children,
}: {
  bundle: ProjectBundle;
  items: WorkItem[];
  raid?: RaidView[];
  reports?: ReportSummary[];
  children?: React.ReactNode;
}) {
  const path = usePathname();
  const visible = items.filter((i) => i.type !== 'epic');
  return (
    <ProjectBundleProvider value={bundle}>
      <Stack spacing={2}>
        <Typography variant="h1">{bundle.project.name}</Typography>
        <Paper sx={{ p: 3, borderRadius: 4 }}>
          <GateTracker phases={bundle.phases} />
        </Paper>
        {children}
        <Paper sx={{ borderRadius: 4 }}>
          <Stack direction="row" alignItems="center" sx={{ p: 2 }}>
            <Typography variant="h3" sx={{ flex: 1 }}>
              Shared work
            </Typography>
            {visible.length > 0 && <ExportMenu entity="items" params={{ project: bundle.project.key }} />}
          </Stack>
          {visible.length === 0 ? (
            <EmptyState
              title="Nothing shared yet"
              body="Your delivery team shares work items here as they progress."
            />
          ) : (
            <List>
              {visible.map((i) => (
                <ListItemButton key={i.id} component={Link} href={`${path}?item=${i.key}`} scroll={false}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <TypeIcon type={i.type} />
                  </ListItemIcon>
                  <ListItemText primary={i.title} secondary={<ItemKey k={i.key} />} />
                  <Chip
                    size="small"
                    label={STATUS_LABEL[i.status]}
                    color={
                      i.status === 'client_review'
                        ? 'warning'
                        : i.status === 'accepted'
                          ? 'success'
                          : 'default'
                    }
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Paper>
        <SharedRaid entries={raid} />
        <PortalReportsSection projectKey={bundle.project.key} reports={reports} />
      </Stack>
      <Suspense fallback={null}>
        <ItemPanel projectId={bundle.project.id} />
      </Suspense>
    </ProjectBundleProvider>
  );
}
