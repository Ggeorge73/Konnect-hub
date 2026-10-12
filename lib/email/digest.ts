import type { Profile } from '../domain/types';
import { selectDigest, type Notification, type NotificationPref } from '../domain/notifications';
import { digestEmail, type EmailMessage } from './templates';

export interface Digest {
  email: EmailMessage;
  /** Notification ids included, to stamp `digestedAt` after sending. */
  ids: string[];
}

/**
 * Daily digest builder (pure). Returns null when the user has nothing to digest, so nobody gets
 * an empty email. At most 50 entries; the rest are still in the notification center.
 */
export function buildDigest(
  user: Pick<Profile, 'id' | 'name' | 'email'>,
  notifications: Notification[],
  prefs: NotificationPref[],
  now: Date,
  base?: string,
): Digest | null {
  const items = selectDigest(notifications, prefs, user.id, now).slice(0, 50);
  if (!items.length) return null;
  return { email: digestEmail(user.email, user.name, items, base), ids: items.map((n) => n.id) };
}
