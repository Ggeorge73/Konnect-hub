/**
 * Minimal RFC 5545 (iCalendar) writer for the milestone feed (ICS-01). Pure functions only.
 * All-day events (DATE values), CRLF line endings, TEXT escaping and 75-octet line folding.
 */
export interface IcsEvent {
  uid: string;
  /** YYYY-MM-DD (all-day). */
  date: string;
  summary: string;
  description?: string;
  url?: string;
  categories?: string[];
}

/** RFC 5545 §3.3.11: escape backslash, semicolon and comma; newlines become \n. */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + a single space. Splits on
 * UTF-8 octets without breaking a multi-byte character.
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75; // continuation lines start with a space, so they carry 74 octets of content
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      parts.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74;
    }
    cur += ch;
    curBytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const ymd = (date: string) => date.slice(0, 10).replace(/-/g, '');

function nextDay(date: string) {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** UTC timestamp in iCalendar form, e.g. 20261012T090000Z. */
export const icsStamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

export function buildCalendar(opts: { name: string; events: IcsEvent[]; now?: Date }): string {
  const stamp = icsStamp(opts.now ?? new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Konnector LLC//Konnect Hub//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  for (const e of opts.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`,
      `DTEND;VALUE=DATE:${ymd(nextDay(e.date))}`,
      `SUMMARY:${escapeText(e.summary)}`,
      'TRANSP:TRANSPARENT',
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(escapeText).join(',')}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
