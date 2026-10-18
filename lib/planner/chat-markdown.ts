/**
 * The little markdown ALMA writes, turned into styled spans for the chat.
 *
 * The prompt asks for short paragraphs with no headers or tables, but the
 * model still bolds a course code or a deadline now and then, and the panel
 * printed the marks as is: "**Oct 16**". This reads the handful of marks a
 * chat reply uses and drops the rest:
 *
 *   **bold** and __bold__   -> strong
 *   *italic*                -> em (only around a word, so "3 * 4" stays)
 *   `code`                  -> code
 *   [label](https://...)    -> a link, http and https only; a pair of
 *                              parentheses inside the address is kept
 *                              (".../Hannon_Econ%20415(367)_SP02.pdf")
 *   # Heading               -> the line in bold, marks dropped
 *   * item / + item         -> "• item" ("- item" is already fine as text)
 *
 * A "**" left over (an unclosed pair, or one half of a pair still being
 * streamed) is dropped rather than shown. Underscores inside words are left
 * alone, because tool names and fields like crnc_eligible are words.
 *
 * Pure and React-free so __chat-markdown.check.mjs can test it; the panel
 * (components/planner/advisor.tsx) maps the spans to elements. Newlines are
 * kept in the text, and the bubble's white-space: pre-wrap shows them.
 *
 * chatLines reads the same marks line by line, for the panel: a syllabus
 * answer is a bold course line with one "- **Instructor**: ..." line per
 * instructor under it (SHARED_ADVISOR_RULES.syllabusLayout), and a list item
 * drawn as plain text wraps under its dash instead of under its words.
 */

export interface ChatSpan {
  text: string;
  strong?: boolean;
  em?: boolean;
  code?: boolean;
  /** Only ever an http or https address. */
  href?: string;
}

const INLINE =
  /(\*\*|__)(?=\S)([\s\S]*?\S)\1|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)|(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g;

function plain(text: string, base: Omit<ChatSpan, 'text'>): ChatSpan[] {
  const cleaned = text.replace(/\*\*/g, '');
  return cleaned ? [{ ...base, text: cleaned }] : [];
}

function inline(text: string, base: Omit<ChatSpan, 'text'> = {}): ChatSpan[] {
  const out: ChatSpan[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    out.push(...plain(text.slice(last, at), base));
    if (m[2] !== undefined) out.push(...inline(m[2], { ...base, strong: true }));
    else if (m[3] !== undefined) out.push({ ...base, text: m[3], code: true });
    else if (m[4] !== undefined && m[5] !== undefined) out.push(...inline(m[4], { ...base, href: m[5] }));
    else if (m[6] !== undefined) out.push(...inline(m[6], { ...base, em: true }));
    last = at + m[0].length;
  }
  out.push(...plain(text.slice(last), base));
  return out;
}

/** Same-styled neighbours joined, so the panel draws as few elements as it can. */
function merge(spans: ChatSpan[]): ChatSpan[] {
  const out: ChatSpan[] = [];
  const same = (a: ChatSpan, b: ChatSpan) => !!a.strong === !!b.strong && !!a.em === !!b.em && !!a.code === !!b.code && a.href === b.href;
  for (const s of spans) {
    const prev = out[out.length - 1];
    if (prev && same(prev, s)) prev.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

export function chatSpans(text: string): ChatSpan[] {
  const lines = text.split('\n');
  const spans: ChatSpan[] = [];
  lines.forEach((line, i) => {
    let body = line;
    let base: Omit<ChatSpan, 'text'> = {};
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(body);
    if (heading) {
      body = heading[1];
      base = { strong: true };
    } else {
      body = body.replace(/^(\s*)[*+]\s+/, '$1• ');
    }
    spans.push(...inline(body, base));
    if (i < lines.length - 1) spans.push({ text: '\n' });
  });
  return merge(spans);
}

/** The reply as plain text with every mark dropped (for a copy, a title or a preview). */
export function chatPlainText(text: string): string {
  return chatSpans(text)
    .map((s) => (s.href ? `${s.text} (${s.href})` : s.text))
    .join('');
}

/** One line of a reply, for the panel: a paragraph line, a list item, or a blank line between them. */
export interface ChatLine {
  kind: 'text' | 'item' | 'blank';
  /** How far a list item is nested: 0 for "- x", 1 for "  - x". */
  depth: number;
  /** "•" for a bullet, "1." for a numbered item. */
  marker?: string;
  spans: ChatSpan[];
}

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const ITEM = /^(\s*)([-*+•]|\d{1,2}[.)])\s+(.*)$/;

/** The reply line by line, each with its own spans; "- item", "* item", "• item" and "1. item" are list items. */
export function chatLines(text: string): ChatLine[] {
  return text.split('\n').map((line): ChatLine => {
    if (!line.trim()) return { kind: 'blank', depth: 0, spans: [] };
    const heading = HEADING.exec(line);
    if (heading) return { kind: 'text', depth: 0, spans: merge(inline(heading[1], { strong: true })) };
    const item = ITEM.exec(line);
    if (item) {
      const depth = Math.min(3, Math.floor(item[1].replace(/\t/g, '  ').length / 2));
      const marker = /\d/.test(item[2]) ? item[2].replace(')', '.') : '•';
      return { kind: 'item', depth, marker, spans: merge(inline(item[3])) };
    }
    return { kind: 'text', depth: 0, spans: merge(inline(line)) };
  });
}
