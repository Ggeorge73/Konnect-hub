import type { Comment, WorkItem } from './types';

/**
 * Item watchers (NTF-01). The reporter, the assignee and every commenter watch automatically;
 * anyone who can see the item can watch or unwatch it from the panel. An explicit unwatch is kept
 * as `watching: false` so the person stays unsubscribed until they comment, are assigned, or
 * watch again.
 */
export interface Watcher {
  itemId: string;
  userId: string;
  watching: boolean;
  at: string;
}

export const watcherIds = (watchers: Watcher[], itemId: string) =>
  watchers.filter((w) => w.itemId === itemId && w.watching).map((w) => w.userId);

export const isWatching = (watchers: Watcher[], itemId: string, userId: string) =>
  watchers.some((w) => w.itemId === itemId && w.userId === userId && w.watching);

/** Sets (or creates) a watcher row in place. Returns true when it changed. */
export function setWatching(
  watchers: Watcher[],
  itemId: string,
  userId: string,
  watching: boolean,
  at: string,
): boolean {
  const row = watchers.find((w) => w.itemId === itemId && w.userId === userId);
  if (row) {
    if (row.watching === watching) return false;
    Object.assign(row, { watching, at });
    return true;
  }
  watchers.push({ itemId, userId, watching, at });
  return true;
}

/** The automatic watchers of an item: reporter, assignee and commenters, without duplicates. */
export function autoWatchers(item: Pick<WorkItem, 'id' | 'reporterId' | 'assigneeId'>, comments: Comment[]) {
  return [
    ...new Set(
      [
        item.reporterId,
        item.assigneeId,
        ...comments.filter((c) => c.entityId === item.id).map((c) => c.authorId),
      ].filter((x): x is string => Boolean(x)),
    ),
  ];
}
