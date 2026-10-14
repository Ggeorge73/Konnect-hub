import { Suspense } from 'react';
import { RaidRegister } from '@/features/raid/RaidRegister';
import { SuggestedRisks } from '@/features/ai/SuggestedRisks';
export const metadata = { title: 'RAID log' };
export default function Page() {
  return (
    <Suspense>
      <SuggestedRisks />
      <RaidRegister />
    </Suspense>
  );
}
