'use client';
import Link from 'next/link';
import { Button, Paper, Stack, Typography } from '@mui/material';
import InsightsOutlined from '@mui/icons-material/InsightsOutlined';

/** Portal entry point to the client-safe executive dashboard. */
export function PortalDashboardLink({ projectKey }: { projectKey: string }) {
  return (
    <Paper sx={{ p: 2, borderRadius: 4 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <InsightsOutlined color="primary" aria-hidden />
        <Typography sx={{ flex: 1 }}>
          Status, milestones, top risks and what&apos;s next, on one page you can print or export.
        </Typography>
        <Button variant="contained" component={Link} href={`/portal/${projectKey}/dashboard`}>
          Open dashboard
        </Button>
      </Stack>
    </Paper>
  );
}
