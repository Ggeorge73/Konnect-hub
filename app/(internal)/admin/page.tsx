import { ComingSoon } from '@/components/ui/ComingSoon';
export const metadata = { title: 'Admin' };
export default function Page() {
  return (
    <ComingSoon
      title="Admin"
      sprint="PI-1 Sprint 4"
      body="Users, roles, client orgs, templates, workflows, custom fields, branding and the audit log."
    />
  );
}
