'use client';
import { Avatar, AvatarGroup, Tooltip } from '@mui/material';
import { usePeople } from '@/lib/client/api';
import { initials } from '@/components/ui/bits';
import { usePresence } from './useRealtime';

/** Avatars of the other people viewing this item right now (RT-01). */
export function PresenceAvatars({ itemKey }: { itemKey: string }) {
  const viewers = usePresence(itemKey);
  const { data: people = [] } = usePeople();
  const named = viewers
    .map((v) => people.find((p) => p.id === v.userId))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (!named.length) return null;
  const label = `Also viewing: ${named.map((p) => p.name).join(', ')}`;
  return (
    <AvatarGroup
      max={4}
      role="group"
      aria-label={label}
      data-testid="presence-avatars"
      sx={{ '& .MuiAvatar-root': { width: 28, height: 28, fontSize: 12, borderColor: 'background.paper' } }}
    >
      {named.map((p) => (
        <Tooltip key={p.id} title={`${p.name} is viewing`}>
          <Avatar alt={p.name} sx={{ bgcolor: 'secondary.main', color: '#FFFFFF' }}>
            {initials(p.name)}
          </Avatar>
        </Tooltip>
      ))}
    </AvatarGroup>
  );
}
