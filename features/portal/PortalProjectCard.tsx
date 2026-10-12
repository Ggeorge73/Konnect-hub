'use client';
import { CardContent, Stack, Typography, LinearProgress } from '@mui/material';
import { GateTracker } from '@/components/ui/GateTracker';
import { RagChip } from '@/components/ui/bits';
import type { ProjectSummary } from '@/lib/data/repo';
import type { Phase } from '@/lib/domain/types';

export function PortalProjectCard({ project, phases }: { project: ProjectSummary; phases: Phase[] }) {
  return (
    <CardContent>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h3">{project.name}</Typography>
        <RagChip rag={project.rag} />
      </Stack>
      <GateTracker phases={phases} />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
        <LinearProgress
          variant="determinate"
          value={project.percentComplete}
          sx={{ flex: 1, height: 6, borderRadius: 3 }}
          aria-label="Percent complete"
        />
        <Typography variant="caption">{project.percentComplete}% complete</Typography>
      </Stack>
    </CardContent>
  );
}
