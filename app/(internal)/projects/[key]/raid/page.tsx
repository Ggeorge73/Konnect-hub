import { Paper } from '@mui/material';
import { EmptyState } from '@/components/ui/bits';
export const metadata = { title: 'RAID log' };
export default function Page() {
  return (
    <Paper sx={{ borderRadius: 4 }}>
      <EmptyState
        title="RAID log arrives in PI-1 Sprint 2"
        body="No risks logged yet. Projects that log risks early recover faster. The RAID log with the 5×5 heat map arrives next sprint."
      />
    </Paper>
  );
}
