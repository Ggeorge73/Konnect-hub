'use client';
import { createContext, Suspense, useContext } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Alert, Box, Paper, Skeleton, Stack, Tab, Tabs, Typography } from '@mui/material';
import { useProject } from '@/lib/client/api';
import type { ProjectBundle } from '@/lib/data/repo';
import { GateTracker } from '@/components/ui/GateTracker';
import { Mono, RagChip } from '@/components/ui/bits';
import { ItemPanel } from '@/features/items/ItemPanel';

const Ctx = createContext<ProjectBundle | null>(null);
export const ProjectBundleProvider = Ctx.Provider;
export const useProjectBundle = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProjectBundle outside ProjectFrame');
  return v;
};

const TABS = [
  { label: 'Overview', seg: '' },
  { label: 'Board', seg: 'board' },
  { label: 'Backlog', seg: 'backlog' },
  { label: 'List', seg: 'list' },
  { label: 'Timeline', seg: 'timeline' },
  { label: 'RAID', seg: 'raid' },
];

export function ProjectFrame({ projectKey, children }: { projectKey: string; children: React.ReactNode }) {
  const { data, error, isLoading } = useProject(projectKey);
  const path = usePathname();
  const seg = path.split('/')[3] ?? '';
  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (isLoading || !data) return <Skeleton variant="rounded" height={140} />;
  const { project } = data;
  return (
    <Ctx.Provider value={data}>
      <Paper sx={{ p: 2.5, borderRadius: 4, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">
              <Mono>{project.key}</Mono> · {data.client.name}
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="h1" noWrap>
                {project.name}
              </Typography>
              <RagChip rag={project.rag} reason={project.ragReason} />
            </Stack>
          </Box>
          <Box sx={{ flex: 1, minWidth: { md: 380 }, maxWidth: { md: 560 }, ml: { md: 'auto' } }}>
            <GateTracker phases={data.phases} />
          </Box>
        </Stack>
        <Tabs
          value={TABS.some((t) => t.seg === seg) ? seg : false}
          sx={{ mt: 1.5, minHeight: 36 }}
          variant="scrollable"
          aria-label="Project sections"
        >
          {TABS.map((t) => (
            <Tab
              key={t.seg}
              value={t.seg}
              label={t.label}
              component={Link}
              href={`/projects/${project.key}${t.seg ? '/' + t.seg : ''}`}
              sx={{ minHeight: 36 }}
            />
          ))}
        </Tabs>
      </Paper>
      {children}
      <Suspense fallback={null}>
        <ItemPanel projectId={project.id} />
      </Suspense>
    </Ctx.Provider>
  );
}
