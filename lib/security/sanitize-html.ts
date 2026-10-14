/**
 * Allowlist HTML sanitizer for rich text that is rendered as HTML (weekly status report sections in
 * the client portal). KH-47 SEC-03 finding F-04: report sections arrive as HTML from the editor and
 * the portal renders them with dangerouslySetInnerHTML, so a crafted PATCH could store script for
 * every client user who opens the report.
 *
 * Keeps only the formatting tags the Tiptap editor produces, strips every attribute (so no event
 * handlers, styles or ids), keeps `href` on links only for http(s), mailto and relative URLs, and
 * drops the content of script-like elements entirely. Pure and dependency-free, so it runs on the
 * server (at write) and in the browser (at render) alike.
 */
const ALLOWED = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  's',
  'u',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'a',
  'span',
]);
const VOID = new Set(['br', 'hr']);
const DROP_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'template',
  'noscript',
  'noembed',
  'noframes',
  'textarea',
  'title',
  'svg',
  'math',
  'select',
  'xmp',
  'plaintext',
  'head',
]);

const TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<[!?][^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>|<|>|[^<>]+/g;

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cp = (n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '�');

/** Decodes numeric and the common named entities, for checking a URL's real scheme. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => cp(Number(d)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

/** A safe href, or null. Allows http(s), mailto, and same-site relative / fragment URLs. */
export function safeHref(raw: string): string | null {
  // Browsers ignore control characters and spaces inside a URL scheme ("java\tscript:").
  const url = decodeEntities(raw).replace(/[\u0000- \u007f-\u009f]/g, '');
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^(\/(?!\/)|#|\?)/.test(url)) return url;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//') && url !== '') return url; // relative path
  return null;
}

function linkAttrs(attrs: string): string {
  const m = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  const href = m ? safeHref(m[1] ?? m[2] ?? m[3] ?? '') : null;
  return href === null
    ? ''
    : ` href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow"`;
}

export function sanitizeHtml(input: string): string {
  let out = '';
  let skip: string | null = null;
  let depth = 0;
  for (const m of input.matchAll(TOKEN)) {
    const tok = m[0];
    const rawName = m[2];
    if (tok.startsWith('<!') || tok.startsWith('<?')) continue; // comments, doctype, CDATA
    if (rawName) {
      const name = rawName.toLowerCase();
      const closing = m[1] === '/';
      const attrs = m[3] ?? '';
      if (skip) {
        if (name === skip) {
          depth += closing ? -1 : 1;
          if (depth === 0) skip = null;
        }
        continue;
      }
      if (DROP_CONTENT.has(name)) {
        if (!closing && !/\/\s*$/.test(attrs)) {
          skip = name;
          depth = 1;
        }
        continue;
      }
      if (!ALLOWED.has(name)) continue;
      if (closing) {
        if (!VOID.has(name)) out += `</${name}>`;
      } else out += `<${name}${name === 'a' ? linkAttrs(attrs) : ''}>`;
      continue;
    }
    if (skip) continue;
    out += tok === '<' ? '&lt;' : tok === '>' ? '&gt;' : tok;
  }
  return out;
}
