import { RoleShell } from '@/features/notifications/RoleShell';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <RoleShell>{children}</RoleShell>;
}
