import { Suspense } from 'react';
import { TimelineView } from '@/features/timeline/TimelineView';
export const metadata = { title: 'Timeline' };
export default function Page() {
  return (
    <Suspense>
      <TimelineView />
    </Suspense>
  );
}
