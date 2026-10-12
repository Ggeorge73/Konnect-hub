import { Suspense } from 'react';
import { ItemTable } from '@/features/list/ItemTable';
export const metadata = { title: 'List' };
export default function Page() {
  return (
    <Suspense>
      <ItemTable />
    </Suspense>
  );
}
