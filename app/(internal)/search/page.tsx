import { Suspense } from 'react';
import { SearchPage } from '@/features/search/SearchPage';
export const metadata = { title: 'Search' };
export default function Page() {
  return (
    <Suspense>
      <SearchPage />
    </Suspense>
  );
}
