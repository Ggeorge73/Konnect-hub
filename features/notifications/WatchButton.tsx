'use client';
import { Button, Tooltip } from '@mui/material';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import { useSetWatch, useWatch } from './api';

/** "Watch" toggle in the item panel: watchers hear about status changes on the item. */
export function WatchButton({ itemKey }: { itemKey: string }) {
  const { data } = useWatch(itemKey);
  const set = useSetWatch(itemKey);
  const watching = Boolean(data?.watching);
  const count = data?.count ?? 0;
  return (
    <Tooltip
      describeChild
      title={`${
        watching
          ? 'You get notified when this item changes status. Click to stop watching.'
          : 'Get notified when this item changes status.'
      } ${count} ${count === 1 ? 'person is' : 'people are'} watching.`}
    >
      <Button
        size="small"
        variant={watching ? 'contained' : 'outlined'}
        color="primary"
        aria-pressed={watching}
        onClick={() => data && !set.isPending && set.mutate(!watching)}
        startIcon={watching ? <VisibilityOutlined /> : <VisibilityOffOutlined />}
        sx={{ minWidth: 0, whiteSpace: 'nowrap' }}
      >
        {watching ? 'Watching' : 'Watch'}
      </Button>
    </Tooltip>
  );
}
