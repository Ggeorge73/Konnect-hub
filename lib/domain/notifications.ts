/** In-app notifications (CLAUDE.md 3.10). Email delivery and preferences come later. */
export type NotificationKind = 'sla_breach' | 'risk_escalated' | 'status_report_published';

export interface Notification {
  id: string;
  userId: string;
  projectId: string;
  kind: NotificationKind;
  title: string;
  href: string;
  createdAt: string;
  readAt: string | null;
}

/** Lead plus every Admin, without duplicates (a Lead who is also an Admin gets one). */
export function escalationRecipients(leadId: string | null | undefined, adminIds: string[]): string[] {
  return [...new Set([...(leadId ? [leadId] : []), ...adminIds])];
}
