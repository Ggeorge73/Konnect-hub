import type { RiskSignal, SignalKind } from '../domain/ai';
import { readDataBlock } from './prompts';
import type { AiClient, AiRequest, AiResponse } from './types';

/**
 * Deterministic stand-in for Claude: used whenever no API key is set, and in all tests and CI.
 * It reads the same `<data>` blocks the real model gets and answers with JSON in the same shapes,
 * so every feature runs end to end (including the client-only filtering, which happens before the
 * prompt is built). Same input, same output; no network.
 */
export const FAKE_MODEL = 'konnect-fake-1';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const tokens = (s: string) => Math.ceil(s.length / 4);

function statusReport(content: string) {
  const sections = readDataBlock<{ id: string; label: string; facts: string }[]>(content, 'sections') ?? [];
  return {
    sections: sections.map((s) => {
      const lines = s.facts
        .split('\n')
        .map((l) => l.replace(/^-\s*/, '').trim())
        .filter(Boolean);
      const lead = lines[0] ?? 'No update this week.';
      const rest = lines.slice(1);
      return {
        id: s.id,
        html:
          `<p><strong>${esc(s.label)} in brief:</strong> ${esc(lead)}</p>` +
          (rest.length ? `<ul>${rest.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''),
      };
    }),
  };
}

const RISK_BY_KIND: Record<SignalKind, { category: string; p: number; i: number; mitigation: string }> = {
  stalled: {
    category: 'schedule',
    p: 3,
    i: 3,
    mitigation: 'Check in with the assignee within two days, remove the blocker or re-plan the work.',
  },
  overdue: {
    category: 'schedule',
    p: 4,
    i: 3,
    mitigation: 'Agree a new date with the owner and tell affected stakeholders; re-sequence dependent work.',
  },
  sprint_miss: {
    category: 'schedule',
    p: 3,
    i: 3,
    mitigation: 'Re-scope the sprint with the team now and move the lowest-priority items to the backlog.',
  },
  deliverable_late: {
    category: 'reputational',
    p: 4,
    i: 4,
    mitigation: 'Book the acceptance review with the client this week and agree what is still needed.',
  },
};

function riskSuggestions(content: string) {
  const signals =
    readDataBlock<Pick<RiskSignal, 'key' | 'kind' | 'title' | 'itemKeys'>[]>(content, 'signals') ?? [];
  return {
    suggestions: signals.map((s) => {
      const r = RISK_BY_KIND[s.kind];
      return {
        title: clip(`Risk of delay: ${s.title}`, 120),
        category: r.category,
        probability: r.p,
        impact: r.i,
        mitigation: r.mitigation,
        signalKeys: [s.key],
        linkedItemKeys: s.itemKeys,
      };
    }),
  };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

function dueFrom(line: string, today: string): string | null {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(line);
  if (iso) return iso[1];
  if (/\btomorrow\b/i.test(line)) return addDays(today, 1);
  const wd = new RegExp(`\\b(?:by|on|before)\\s+(${WEEKDAYS.join('|')})\\b`, 'i').exec(line);
  if (wd) {
    const want = WEEKDAYS.indexOf(wd[1].toLowerCase());
    const now = new Date(today + 'T00:00:00Z').getUTCDay();
    return addDays(today, (want - now + 7) % 7 || 7);
  }
  return null;
}

const ACTION = /^\s*(?:[-*•]|\[\s?\]|\d+[.)]|todo:?|action:?|ai:)\s*/i;

function meetingNotes(content: string) {
  const notes = readDataBlock<{ text: string }>(content, 'notes')?.text ?? '';
  const members = readDataBlock<{ id: string; name: string }[]>(content, 'members') ?? [];
  const today = readDataBlock<{ today: string }>(content, 'project')?.today ?? '2026-01-01';
  const items = notes
    .split('\n')
    .filter((l) => ACTION.test(l) && l.replace(ACTION, '').trim().length > 2)
    .map((raw) => {
      const line = raw.replace(ACTION, '').trim();
      const who = members.find((m) => {
        const first = m.name.split(/\s+/)[0];
        return first && new RegExp(`\\b${first.replace(/[^A-Za-z]/g, '')}\\b`, 'i').test(line);
      });
      const type = /\b(bug|defect|broken|error|crash)/i.test(line)
        ? 'bug'
        : /\b(change request|scope change)\b/i.test(line)
          ? 'change_request'
          : 'task';
      const priority = /\b(urgent|asap|blocker|critical)\b/i.test(line)
        ? 'critical'
        : /\b(important|high priority)\b/i.test(line)
          ? 'high'
          : 'medium';
      const title = line
        .replace(/@\S+/g, '')
        .replace(/\b(?:by|on|before)\s+(?:\d{4}-\d{2}-\d{2}|[A-Za-z]+day|tomorrow)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      return {
        type,
        title: clip(title.charAt(0).toUpperCase() + title.slice(1), 120),
        description: `From the meeting notes: "${clip(line, 300)}"`,
        assigneeId: who?.id ?? null,
        priority,
        dueDate: dueFrom(line, today),
      };
    });
  return { items: items.slice(0, 25) };
}

function threadSummary(content: string) {
  const comments = readDataBlock<{ author: string; text: string }[]>(content, 'comments') ?? [];
  const authors = [...new Set(comments.map((c) => c.author))];
  const last = comments[comments.length - 1];
  return {
    summary: last
      ? `${comments.length} comments from ${authors.join(', ')}. Most recently ${last.author} wrote: "${clip(last.text, 160)}"`
      : 'There are no comments to summarise.',
    keyPoints: comments.slice(-5).map((c) => `${c.author}: ${clip(c.text, 100)}`),
  };
}

export function createFakeClient(): AiClient {
  return {
    provider: 'fake',
    model: FAKE_MODEL,
    async complete(req: AiRequest): Promise<AiResponse> {
      const content = req.messages.map((m) => m.content).join('\n');
      const out =
        req.feature === 'status_report'
          ? statusReport(content)
          : req.feature === 'risk_suggestions'
            ? riskSuggestions(content)
            : req.feature === 'meeting_notes'
              ? meetingNotes(content)
              : threadSummary(content);
      const text = JSON.stringify(out);
      return {
        text,
        model: FAKE_MODEL,
        inputTokens: tokens(req.system + content),
        outputTokens: tokens(text),
      };
    },
  };
}

export const fakeClient = createFakeClient();
