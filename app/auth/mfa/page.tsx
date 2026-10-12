import { isSupabaseConfigured } from '@/lib/config';
import { MfaForm } from './MfaForm';

export const metadata = { title: 'Two-step verification' };
export const dynamic = 'force-dynamic';

export default function MfaPage() {
  return <MfaForm configured={isSupabaseConfigured()} />;
}
