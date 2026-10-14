'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Box,
  Chip,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import type { ProjectBundle } from '@/lib/data/repo';
import type { Rag, WorkItem } from '@/lib/domain/types';
import { GateTracker } from '@/components/ui/GateTracker';
import { EmptyState, ItemKey, RagChip, TypeIcon } from '@/components/ui/bits';
import { STATUS_LABEL } from '@/lib/domain/workflow';
import { ItemPanel } from '@/features/items/ItemPanel';
import { ProjectBundleProvider } from '@/features/projects/ProjectFrame';
import { SharedRaid } from '@/features/raid/SharedRaid';
import type { RaidView } from '@/lib/domain/raid';
import { PortalReportsSection } from '@/features/reports/PortalReports';
import type { ReportSummary } from '@/lib/data/reports';
import type { Milestone } from '@/lib/domain/portal';
import { PortalSectionNav } from './PortalSectionNav';
import { MilestonesTimeline } from './MilestonesTimeline';
import { SubmitRequestButton } from './RequestDialog';

const anchor = { scrollMarginTop: 120 } as const;

/**
 * Portal project page, organised into anchored sections: Overview (gate tracker + dashboard),
 * Approvals (gate reviews + deliverables), Work (shared items), Status reports, shared Risks and
 * issues, and the Milestones timeline.
 */
export function PortalProject({
  bundle,
  items,
  raid = [],
  reports = [],
  milestones = [],
  rag,
  canRequest = false,
  overview,
  approvals,
}: {
  bundle: ProjectBundle;
  items: WorkItem[];
  raid?: RaidView[];
  reports?: ReportSummary[];
  milestones?: Milestone[];
  rag?: Rag;
  canRequest?: boolean;
  /** Extra overview content (dashboard link). */
  overview?: React.ReactNode;
  /** Gate reviews and deliverables. */
  approvals?: React.ReactNode;
}) {
  const path = usePathname();
  const visible = items.filter((i) => i.type !== 'epic');
  const project = { id: bundle.project.id, key: bundle.project.key, name: bundle.project.name };
  return (
    <ProjectBundleProvider value={bundle}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h1" sx={{ overflowWrap: 'anywhere' }}>
              {bundle.project.name}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
              <ItemKey k={bundle.project.key} />
              {rag && <RagChip rag={rag} />}
            </Stack>
          </Box>
          {canRequest && <SubmitRequestButton projects={[project]} defaultProjectId={project.id} />}
        </Stack>
        <PortalSectionNav />

        <Stack id="overview" spacing={2} sx={anchor}>
          <Paper sx={{ p: 3, borderRadius: 4 }}>
            <GateTracker phases={bundle.phases} />
          </Paper>
          {overview}
        </Stack>

        <Box id="approvals" sx={anchor}>
          {approvals}
        </Box>

        <Paper id="work" sx={{ borderRadius: 4, ...anchor }}>
          <Typography variant="h3" component="h2" sx={{ p: 2 }}>
            Shared work
          </Typography>
          {visible.length === 0 ? (
            <EmptyState
              title="Nothing shared yet"
              body="Your delivery team shares work items here as they progress. Need something? Raise it as a request."
              action={
                canRequest ? (
                  <SubmitRequestButton
                    projects={[project]}
                    defaultProjectId={project.id}
                    variant="outlined"
                  />
                ) : undefined
              }
            />
          ) : (
            <List>
              {visible.map((i) => (
                <ListItem key={i.id} disablePadding>
                  <ListItemButton component={Link} href={`${path}?item=${i.key}`} scroll={false}>
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
                </ListItem>
              ))}
            </List>
          )}
        </Paper>

        <Box id="reports" sx={anchor}>
          <PortalReportsSection projectKey={bundle.project.key} reports={reports} />
        </Box>
        <Box id="raid" sx={anchor}>
          <SharedRaid entries={raid} />
        </Box>
        <MilestonesTimeline projectKey={bundle.project.key} milestones={milestones} />
      </Stack>
      <Suspense fallback={null}>
        <ItemPanel projectId={bundle.project.id} />
      </Suspense>
    </ProjectBundleProvider>
  );
}
