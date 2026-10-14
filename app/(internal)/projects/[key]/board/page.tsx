import { Suspense } from 'react';
import { KanbanBoard } from '@/features/boards/KanbanBoard';
import { AiToolbar } from '@/features/ai/AiToolbar';
import { MeetingNotesButton } from '@/features/ai/MeetingNotesDialog';
export const metadata = { title: 'Board' };
export default function Page() {
  return (
    <Suspense>
      <AiToolbar>
        <MeetingNotesButton />
      </AiToolbar>
      <KanbanBoard />
    </Suspense>
  );
}
