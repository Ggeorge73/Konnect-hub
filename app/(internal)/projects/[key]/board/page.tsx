import { Suspense } from 'react';
import { KanbanBoard } from '@/features/boards/KanbanBoard';
export const metadata = { title: 'Board' };
export default function Page() {
  return (
    <Suspense>
      <KanbanBoard />
    </Suspense>
  );
}
