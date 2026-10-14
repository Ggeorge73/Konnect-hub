import { Suspense } from 'react';
import { ItemTable } from '@/features/list/ItemTable';
import { AiToolbar } from '@/features/ai/AiToolbar';
import { MeetingNotesButton } from '@/features/ai/MeetingNotesDialog';
export const metadata = { title: 'List' };
export default function Page() {
  return (
    <Suspense>
      <AiToolbar>
        <MeetingNotesButton />
      </AiToolbar>
      <ItemTable />
    </Suspense>
  );
}
