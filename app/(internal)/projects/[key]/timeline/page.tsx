import { Paper } from '@mui/material';
import { EmptyState } from '@/components/ui/bits';
export const metadata = { title: 'Timeline' };
export default function Page() {
  return (
    <Paper sx={{ borderRadius: 4 }}>
      <EmptyState
        title="Timeline arrives in PI-1 Sprint 2"
        body="Phases as bands, gates as diamonds, epics as bars, dependencies and a today line."
      />
    </Paper>
  );
}
