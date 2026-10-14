'use client';
import Link from 'next/link';
import {
  Box,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import { EmptyState, RagChip } from '@/components/ui/bits';
import { REPORT_SECTIONS } from '@/lib/domain/reports';
import type { ReportSummary, ReportView } from '@/lib/data/reports';
import { fmtWeek } from './bits';

/** Portal section: status reports the delivery team has published. */
export function PortalReportsSection({
  projectKey,
  reports,
}: {
  projectKey: string;
  reports: ReportSummary[];
}) {
  return (
    // No aria-label on purpose: a "Status …" label would collide with getByLabel('Status') on the item panel.
    <Paper sx={{ borderRadius: 4 }} component="section" data-testid="portal-status-reports">
      <Typography variant="h3" component="h2" sx={{ p: 2 }} id="status-reports-heading">
        Status reports
      </Typography>
      {reports.length === 0 ? (
        <EmptyState
          title="No status reports yet"
          body="Your delivery lead publishes a weekly status report here."
        />
      ) : (
        <List>
          {reports.map((r) => (
            <ListItem key={r.id} disablePadding>
              <ListItemButton component={Link} href={`/portal/${projectKey}/reports/${r.id}`}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <DescriptionOutlined color="primary" />
                </ListItemIcon>
                <ListItemText
                  primary={`Week of ${fmtWeek(r.weekStart)}`}
                  secondary={`Published ${r.publishedAt ? new Date(r.publishedAt).toLocaleDateString() : ''} by ${r.authorName}`}
                />
                <RagChip rag={r.rag} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      )}
    </Paper>
  );
}

/**
 * One published report in the portal. `sections` is the client copy frozen at publish, which the
 * server sanitized to an allow-list of formatting tags (lib/domain/reports.ts `sanitizeHtml`).
 */
export function PortalReport({ report }: { report: ReportView }) {
  return (
    <Stack spacing={2}>
      <Box>
        <Button
          component={Link}
          href={`/portal/${report.projectKey}`}
          startIcon={<ArrowBack />}
          size="small"
          color="secondary"
        >
          {report.projectName}
        </Button>
      </Box>
      <Paper sx={{ p: 2.5, borderRadius: 4 }}>
        <Typography variant="caption" color="text.secondary">
          Weekly status report
        </Typography>
        <Typography variant="h1">
          {report.projectName}, week of {fmtWeek(report.weekStart)}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }} flexWrap="wrap">
          <RagChip rag={report.rag} />
          {report.ragReason && <Typography>{report.ragReason}</Typography>}
        </Stack>
      </Paper>
      {REPORT_SECTIONS.filter((s) => report.sections[s.id] !== undefined).map((s) => (
        <Paper
          key={s.id}
          component="section"
          aria-labelledby={`portal-section-${s.id}`}
          sx={{ p: 2.5, borderRadius: 4, '& p': { my: 0.5 } }}
        >
          <Typography variant="h3" component="h2" id={`portal-section-${s.id}`} sx={{ mb: 1 }}>
            {s.label}
          </Typography>
          <Box dangerouslySetInnerHTML={{ __html: report.sections[s.id]! }} />
        </Paper>
      ))}
    </Stack>
  );
}
