import type { Comment, WorkItem } from '../domain/types';
import type { NotificationPref } from '../domain/notifications';
import { autoWatchers, type Watcher } from '../domain/watchers';

/** Team Signal tables in the demo store (`db().signal`). */
export interface SignalState {
  watchers: Watcher[];
  notificationPrefs: NotificationPref[];
}

/**
 * Team Signal seed: automatic watchers (reporter, assignee, commenters) for the seeded items, and
 * no explicit notification preferences (everyone starts on the defaults).
 */
export function seedSignal(items: WorkItem[], comments: Comment[]): { signal: SignalState } {
  const watchers = items.flatMap((i) =>
    autoWatchers(i, comments).map((userId) => ({ itemId: i.id, userId, watching: true, at: i.createdAt })),
  );
  return { signal: { watchers, notificationPrefs: [] } };
}
