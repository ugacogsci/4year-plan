/**
 * Terms: "fa2026", "sp2026", "su2026", "wi2026", the same ids offerings.json uses.
 *
 * Illinois's winter session runs December into January and belongs to the
 * spring year ("Winter 2026" is Dec 2025 - Jan 2026), so the order inside a
 * year is wi < sp < su < fa.
 */
const SEASON = { wi: 0, sp: 1, su: 2, fa: 3 };
const WORD = { fall: 'fa', autumn: 'fa', spring: 'sp', summer: 'su', winter: 'wi', fa: 'fa', sp: 'sp', su: 'su', wi: 'wi' };
const LABEL = { fa: 'Fall', sp: 'Spring', su: 'Summer', wi: 'Winter' };

export const termKey = (t) => (t ? Number(t.slice(2)) * 10 + SEASON[t.slice(0, 2)] : -1);
export const termLabel = (t) => (t ? `${LABEL[t.slice(0, 2)]} ${t.slice(2)}` : null);
export const compareTerms = (a, b) => termKey(a) - termKey(b);

/** The term running on a date: Aug-Dec fall, Jan-May spring, Jun-Jul summer. 2026-09-27 -> fa2026. */
export function termOn(date = new Date()) {
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  if (m >= 8) return `fa${y}`;
  if (m >= 6) return `su${y}`;
  return `sp${y}`;
}
export const CURRENT_TERM = termOn();

/** "Current" in coverage terms: Fall 2023 or later, the cut the discovery sweeps used. */
export const CURRENT_FLOOR = 'fa2023';

function year(y) {
  const s = String(y).replace(/^'|^’/, '');
  if (s.length === 4) return Number(s);
  const n = Number(s);
  return n <= 50 ? 2000 + n : 1900 + n;
}

export function makeTerm(season, y) {
  const s = WORD[String(season).toLowerCase()];
  const yy = year(y);
  if (!s || !Number.isFinite(yy) || yy < 1990 || yy > 2100) return null;
  return `${s}${yy}`;
}

/**
 * Every term mention in a string, in order: "Fall 2026", "Fall, 2022",
 * "Spring Semester 2025", "Spring '24", "FA24", "SP 2025", "2026 Fall" and
 * the getsyllabus filename form "_2026_Spring". A bare two-digit year only
 * counts after an apostrophe or in the FA/SP abbreviation, because "Spring 10
 * weeks" and "Fall 12:30" are not terms.
 */
export function termMentions(s) {
  const out = [];
  const text = String(s ?? '');
  const patterns = [
    /(?<![A-Za-z])(Fall|Spring|Summer|Winter|Autumn)[\s,_-]*(?:semester|term|session)?[\s,]*(?:of\s+)?(20\d{2}|19\d{2}|['’]\d{2})(?!\d)/gi,
    /(?<!\d)(20\d{2})[\s_,-]*(Fall|Spring|Summer|Winter)(?![a-z])/gi,
    /(?<![A-Za-z])(FA|SP|SU|WI)[\s_-]?(20\d{2}|\d{2})(?!\d)/g,
  ];
  for (const [i, re] of patterns.entries()) {
    for (const m of text.matchAll(re)) {
      const t = i === 1 ? makeTerm(m[2], m[1]) : makeTerm(m[1], m[2]);
      if (t) out.push({ term: t, at: m.index, text: m[0] });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** "D:20260904121516-05'00'" -> the term it was most likely written for. July-Nov fall, Dec-Apr spring, May-Jun summer. */
export function termFromPdfDate(d) {
  const m = String(d ?? '').match(/(?:D:)?(\d{4})(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (y < 1995) return null;
  if (mo >= 7 && mo <= 11) return `fa${y}`;
  if (mo === 12) return `sp${y + 1}`;
  if (mo <= 4) return `sp${y}`;
  return `su${y}`;
}

/**
 * The document's term from its own text: the most frequent mention on the
 * first page (first 2,500 characters), else in the whole text; ties go to the
 * earliest mention. A syllabus's header names its term; its body names exam
 * dates and, in policy boilerplate, other terms ("grades for Fall 2019 onward"),
 * which is why page one outranks the rest.
 * Falls back to the PDF creation date (low confidence).
 */
export function detectTerm(text, { pdfMeta } = {}) {
  const pick = (mentions) => {
    if (!mentions.length) return null;
    const counts = new Map();
    for (const m of mentions) counts.set(m.term, (counts.get(m.term) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || mentions.findIndex((m) => m.term === a[0]) - mentions.findIndex((m) => m.term === b[0]))[0];
    const first = mentions.find((m) => m.term === best[0]);
    return { term: best[0], count: best[1], distinct: counts.size, evidence: first.text, at: first.at };
  };
  const head = pick(termMentions(String(text ?? '').slice(0, 2500)));
  if (head) return { ...head, method: 'text:page1', confidence: head.distinct === 1 || head.count >= 2 ? 'high' : 'medium' };
  const body = pick(termMentions(text));
  if (body) return { ...body, method: 'text:body', confidence: 'medium' };
  const fromDate = termFromPdfDate(pdfMeta?.creationDate ?? pdfMeta?.modDate);
  if (fromDate) return { term: fromDate, method: 'pdf-date', confidence: 'low', evidence: pdfMeta?.creationDate ?? pdfMeta?.modDate };
  return null;
}
