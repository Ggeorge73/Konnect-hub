import { redirect } from 'next/navigation';

/** Settings home: notification settings are the only personal settings so far. */
export default function Page() {
  redirect('/settings/notifications');
}
