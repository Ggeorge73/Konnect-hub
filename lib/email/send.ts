import type { EmailMessage } from './templates';

/**
 * Email delivery. With RESEND_API_KEY set, mail goes out through Resend from EMAIL_FROM.
 * Otherwise it lands in the in-memory dev outbox, readable at /api/dev/outbox in demo mode.
 */
export interface OutboxEntry extends EmailMessage {
  id: string;
  sentAt: string;
}

const g = globalThis as unknown as { __khOutbox?: OutboxEntry[] };
export const outbox = (): OutboxEntry[] => (g.__khOutbox ??= []);
export const clearOutbox = () => {
  g.__khOutbox = [];
};

const OUTBOX_LIMIT = 500;
let seq = 0;

export const emailEnabled = () => Boolean(process.env.RESEND_API_KEY);

/**
 * Sends (or queues to the dev outbox) without throwing: a mail failure must never fail the
 * action that triggered it. Resend delivery is asynchronous; the outbox write is synchronous.
 */
export function sendEmail(msg: EmailMessage): Promise<void> {
  if (!emailEnabled()) {
    const box = outbox();
    box.push({ ...msg, id: `em_${Date.now().toString(36)}_${++seq}`, sentAt: new Date().toISOString() });
    if (box.length > OUTBOX_LIMIT) box.splice(0, box.length - OUTBOX_LIMIT);
    return Promise.resolve();
  }
  return import('resend')
    .then(async ({ Resend }) => {
      const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: process.env.EMAIL_FROM ?? 'Konnect Hub <hub@konnectortech.com>',
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
      if (error) console.error('Resend error', error.message);
    })
    .catch((e) => console.error('Email send failed', e));
}
