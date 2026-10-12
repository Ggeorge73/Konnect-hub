import { Paper, Typography } from '@mui/material';
import { EmptyState } from './bits';

/** Placeholder for sections scheduled in later PI-1 sprints. */
export function ComingSoon({ title, sprint, body }: { title: string; sprint: string; body: string }) {
  return (
    <>
      <Typography variant="h1" sx={{ mb: 2 }}>
        {title}
      </Typography>
      <Paper sx={{ borderRadius: 4 }}>
        <EmptyState title={`Arrives in ${sprint}`} body={body} />
      </Paper>
    </>
  );
}
