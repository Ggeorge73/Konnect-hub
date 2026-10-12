'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Chip,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import NoteAddOutlined from '@mui/icons-material/NoteAddOutlined';
import { EmptyState, Mono } from '@/components/ui/bits';
import { useGenerateDraft, useReportGrid } from './api';
import { ReportStatusChip, fmtWeek } from './bits';

/** RPT-01: projects × reporting weeks, each a draft, a published report, or "Generate draft". */
export function ReportsPage() {
  const { data, isLoading, error } = useReportGrid();
  const generate = useGenerateDraft();
  const router = useRouter();

  const onGenerate = (projectKey: string, weekStart: string) =>
    generate.mutate({ projectKey, weekStart }, { onSuccess: (r) => router.push(`/reports/${r.id}`) });

  return (
    <>
      <Typography variant="h1" sx={{ mb: 0.5 }}>
        Status reports
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Weekly reports drafted from each week’s activity. The Lead edits and publishes them to the client
        portal.
      </Typography>
      {error && <Alert severity="error">{error.message}</Alert>}
      {generate.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {generate.error.message}
        </Alert>
      )}
      {isLoading || !data ? (
        <Skeleton variant="rounded" height={220} />
      ) : data.projects.length === 0 ? (
        <Paper sx={{ borderRadius: 4 }}>
          <EmptyState
            title="No projects yet"
            body="Status reports appear here once you are on a project."
            action={
              <Button component={Link} href="/projects" variant="contained">
                Go to projects
              </Button>
            }
          />
        </Paper>
      ) : (
        <Paper sx={{ borderRadius: 4 }}>
          <TableContainer>
            <Table aria-label="Status reports by project and week">
              <TableHead>
                <TableRow>
                  <TableCell component="th" scope="col">
                    Project
                  </TableCell>
                  {data.weeks.map((w, k) => (
                    <TableCell key={w} component="th" scope="col">
                      Week of {fmtWeek(w)}
                      {k === 0 ? ' (this week)' : ''}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {data.projects.map((p) => (
                  <TableRow key={p.id} data-testid={`report-row-${p.key}`}>
                    <TableCell component="th" scope="row">
                      <Typography fontWeight={600}>{p.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        <Mono>{p.key}</Mono>
                      </Typography>
                    </TableCell>
                    {data.weeks.map((w) => {
                      const r = data.reports.find((x) => x.projectId === p.id && x.weekStart === w);
                      return (
                        <TableCell key={w}>
                          {r ? (
                            <Link
                              href={`/reports/${r.id}`}
                              aria-label={`${p.name}, week of ${fmtWeek(w)}: ${r.status === 'published' ? 'published' : 'draft'}`}
                            >
                              <ReportStatusChip status={r.status} />
                            </Link>
                          ) : p.canDraft ? (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<NoteAddOutlined />}
                              disabled={generate.isPending}
                              onClick={() => onGenerate(p.key, w)}
                              aria-label={`Generate draft for ${p.name}, week of ${fmtWeek(w)}`}
                            >
                              Generate draft
                            </Button>
                          ) : (
                            <Chip size="small" label="No report" variant="outlined" />
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </>
  );
}
