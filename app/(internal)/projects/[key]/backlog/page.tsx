import { Suspense } from 'react';
import { BacklogView } from '@/features/backlog/BacklogView';
export const metadata = { title: 'Backlog' };
export default function Page() {
  return (
    <Suspense>
      <BacklogView />
    </Suspense>
  );
}
