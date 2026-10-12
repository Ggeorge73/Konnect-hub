import { NotificationSettings } from '@/features/notifications/NotificationSettings';

export const metadata = { title: 'Notification settings' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return <NotificationSettings />;
}
