import { Suspense } from 'react';
import { CriticalTimelineView } from '@/features/timeline/CriticalTimelineView';
export const metadata = { title: 'Timeline' };
export default function Page() {
  return (
    <Suspense>
      <CriticalTimelineView />
    </Suspense>
  );
}
