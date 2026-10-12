import { Suspense } from 'react';
import { RaidRegister } from '@/features/raid/RaidRegister';
export const metadata = { title: 'RAID log' };
export default function Page() {
  return (
    <Suspense>
      <RaidRegister />
    </Suspense>
  );
}
