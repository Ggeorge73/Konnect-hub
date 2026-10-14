import { describe, expect, it } from 'vitest';
import { safeHref, sanitizeHtml } from './sanitize-html';
import { reportPatchSchema } from '../report-schemas';

describe('sanitizeHtml', () => {
  it('keeps the formatting the report editor produces', () => {
    const html =
      '<p><strong>Done</strong> this week:</p><ul><li><p>EHR-4 &amp; EHR-5 <em>shipped</em></p></li></ul><h2>Next</h2><p>a<br>b</p>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('drops scripts and other active content with their contents', () => {
    expect(sanitizeHtml('<p>a</p><script>alert(1)</script><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(sanitizeHtml('<style>body{}</style><iframe src="x"></iframe>ok')).toBe('ok');
    expect(sanitizeHtml('<svg><script>alert(1)</script></svg>x')).toBe('x');
    expect(sanitizeHtml('<SCRIPT >alert(1)</SCRIPT >y')).toBe('y');
    expect(sanitizeHtml('<script><script>x</script>alert(1)</script>z')).toBe('z');
  });

  it('strips every attribute: no event handlers, styles or ids', () => {
    expect(sanitizeHtml('<p onclick="alert(1)" style="x" id="y">t</p>')).toBe('<p>t</p>');
    expect(sanitizeHtml('<img src=x onerror=alert(1)>')).toBe('');
    expect(sanitizeHtml('<p title="a>b" onmouseover=alert(1)>t</p>')).toBe('<p>t</p>');
  });

  it('keeps only safe links, opened in a new tab without an opener', () => {
    expect(sanitizeHtml('<a href="https://konnectortech.com/x?a=1&amp;b=2">k</a>')).toBe(
      '<a href="https://konnectortech.com/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">k</a>',
    );
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="jav&#x61;script:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href=" java\tscript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="data:text/html,<script>">x</a>')).toBe('<a>x</a>');
  });

  it('escapes stray angle brackets and removes comments', () => {
    expect(sanitizeHtml('a < b > c')).toBe('a &lt; b &gt; c');
    expect(sanitizeHtml('<!-- <script>x</script> -->ok')).toBe('ok');
    expect(sanitizeHtml('<p>unterminated <a href="x')).toBe('<p>unterminated &lt;a href="x');
  });

  it('is linear on pathological input', () => {
    const evil = '<a '.repeat(20_000);
    const t = performance.now();
    sanitizeHtml(evil);
    expect(performance.now() - t).toBeLessThan(1_000);
  });
});

describe('safeHref', () => {
  it.each([
    ['https://a.example', 'https://a.example'],
    ['mailto:pm@konnectortech.com', 'mailto:pm@konnectortech.com'],
    ['/portal/EHR', '/portal/EHR'],
    ['#risks', '#risks'],
    ['//evil.example', null],
    ['vbscript:x', null],
    ['', null],
  ])('%s -> %s', (input, want) => {
    expect(safeHref(input)).toBe(want);
  });
});

describe('report section schema', () => {
  it('sanitizes section HTML on the way in', () => {
    const parsed = reportPatchSchema.parse({
      sections: { scope: '<p onclick="x">Hi</p><script>bad()</script>' },
    });
    expect(parsed.sections?.scope).toBe('<p>Hi</p>');
  });
});
