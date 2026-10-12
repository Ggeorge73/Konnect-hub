import { APP_NAME, COMPANY_NAME } from '../config';
import { KIND_LABEL, type Notification } from '../domain/notifications';

/** Simple branded HTML emails (Konnector teal). Inline styles only: email clients drop <style>. */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const TEAL = '#0F9488';
const INK = '#0F172A';
const MUTED = '#475569';

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Absolute link for emails. `APP_URL` in production (e.g. https://hub.konnectortech.com). */
export const appUrl = (path: string, base = process.env.APP_URL ?? 'http://localhost:3000') =>
  new URL(path, base).toString();

function layout(title: string, inner: string, footer: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:Inter,Segoe UI,Arial,sans-serif;color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden">
<tr><td style="background:${TEAL};padding:16px 24px;color:#FFFFFF;font-weight:800;font-size:16px">
<span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:6px;background:#FFFFFF;color:${TEAL};margin-right:8px">K</span>${escapeHtml(APP_NAME)}
</td></tr>
<tr><td style="padding:24px">${inner}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #E2E8F0;color:${MUTED};font-size:12px">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${escapeHtml(href)}" style="display:inline-block;background:${TEAL};color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${escapeHtml(label)}</a>`;

const footer = (prefsHref: string) =>
  `You receive this because of your notification settings in ${escapeHtml(APP_NAME)}. ` +
  `<a href="${escapeHtml(prefsHref)}" style="color:${TEAL}">Change notification settings</a>. ` +
  `${escapeHtml(COMPANY_NAME)}.`;

const ACTION: Partial<Record<Notification['kind'], string>> = {
  gate_requested: 'Review and approve',
  deliverable_awaiting: 'Review deliverable',
  mention: 'Open the conversation',
  assignment: 'Open the item',
};

/** One notification as an immediate email. The button deep-links straight to the action. */
export function notificationEmail(
  to: string,
  n: Pick<Notification, 'kind' | 'title' | 'body' | 'href'>,
  base?: string,
): EmailMessage {
  const href = appUrl(n.href, base);
  const action = ACTION[n.kind] ?? 'Open in Konnect Hub';
  const inner =
    `<p style="margin:0 0 4px;color:${MUTED};font-size:12px;text-transform:uppercase;letter-spacing:.06em">${escapeHtml(KIND_LABEL[n.kind])}</p>` +
    `<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${escapeHtml(n.title)}</h1>` +
    (n.body ? `<p style="margin:0 0 20px;color:${MUTED};line-height:1.5">${escapeHtml(n.body)}</p>` : '') +
    `<p style="margin:0 0 8px">${button(href, action)}</p>` +
    `<p style="margin:16px 0 0;color:${MUTED};font-size:12px">Or paste this link: ${escapeHtml(href)}</p>`;
  return {
    to,
    subject: n.title,
    html: layout(n.title, inner, footer(appUrl('/settings/notifications', base))),
    text: `${n.title}\n\n${n.body ? n.body + '\n\n' : ''}${action}: ${href}\n`,
  };
}

/** The daily digest: a short list of links, newest first. */
export function digestEmail(
  to: string,
  name: string,
  items: Pick<Notification, 'kind' | 'title' | 'href' | 'createdAt'>[],
  base?: string,
): EmailMessage {
  const subject = `Your ${APP_NAME} daily digest: ${items.length} update${items.length === 1 ? '' : 's'}`;
  const rows = items
    .map(
      (n) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid #E2E8F0">` +
        `<a href="${escapeHtml(appUrl(n.href, base))}" style="color:${INK};font-weight:600;text-decoration:none">${escapeHtml(n.title)}</a>` +
        `<div style="color:${MUTED};font-size:12px">${escapeHtml(KIND_LABEL[n.kind])}</div></td></tr>`,
    )
    .join('');
  const inner =
    `<h1 style="margin:0 0 12px;font-size:20px">Good morning, ${escapeHtml(name.split(' ')[0])}</h1>` +
    `<p style="margin:0 0 12px;color:${MUTED}">Here is what happened in the last 24 hours.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>` +
    `<p style="margin:20px 0 0">${button(appUrl('/notifications', base), 'Open notifications')}</p>`;
  return {
    to,
    subject,
    html: layout(subject, inner, footer(appUrl('/settings/notifications', base))),
    text: `${subject}\n\n${items.map((n) => `- ${n.title}: ${appUrl(n.href, base)}`).join('\n')}\n`,
  };
}
