/**
 * Illinois graduate and professional programs, as structured data.
 *
 * Run it through the degree crawler, which owns the table parser:
 *
 *   node scripts/illinois/programs.mjs --graduate
 *   node scripts/illinois/programs.mjs --graduate --graduate-cache <dir>
 *
 * A full degree crawl (programs.mjs with no --only) runs this too when it
 * finishes, after the minors, so graduate programs are refreshed whenever the
 * undergraduate degrees are and cannot quietly fall a catalog year behind.
 * --graduate-cache reads pages saved in a folder and fetches (and saves) only
 * the ones missing from it; without it every page is fetched.
 *
 * What it reads. The catalog lists its graduate programs on four index pages,
 * one request each, so nothing is walked:
 *
 *   /graduate/                  every graduate degree, with its concentrations
 *                               nested under it
 *   /graduate/certificates/     graduate certificates (GCRT)
 *   /graduate/graduate-minors/  graduate minors
 *   /professional/              JD, DVM, MD, MD-PhD
 *
 * plus the concentration pages of degrees whose own page says a concentration
 * is required (MPH, MSW, Theatre MFA...), since those degrees print their
 * courses there. Joint degrees and add-on concentrations are not read.
 *
 * Graduate pages use the same CourseLeaf course tables as undergraduate pages,
 * so the same parseTables reads the rows. What differs is around the tables,
 * and each difference is read here:
 *
 *   - Totals. Each option table ends in its own "Total Hours 32" row, some
 *     pages print the total as a heading row ("Total hours (Minimum Required)
 *     48") or a plain row ("Total Hours 44-56"), and some only in the rules
 *     table ("Total credit hours for the degree 32", "Minimum Total Hours to
 *     Graduate 90"). programs.mjs's programTotal accepts 100 to 200 and finds
 *     none of them.
 *   - Options. Thesis and non-thesis, or entering with a bachelor's or a
 *     master's, are printed as separate tables, each with its own total.
 *     Read as one program they add up (History MA would be 64 hours, not 32).
 *     Here each becomes an option the student picks one of.
 *   - Hour buckets. "Advanced courses chosen from CS 500 - CS 590 ... 12",
 *     "Elective courses 0-8": a row with hours and no course code. The table
 *     parser keeps it as a comment row inside the group above; here each
 *     becomes its own group with no courses, its hours and its hours range,
 *     so the reader (lib/planner/illinois-graduate.ts) can size it.
 *   - The rules table ("Other Requirements and Conditions"): minimum 500-level
 *     hours, minimum GPA, hours that must be taken on campus, completion
 *     windows, whether a concentration is required, thesis or not. Kept as
 *     numbers and flags plus facts in our own words with the page link.
 *   - A page that prints its requirements only as rules rows (ECE MEng) is
 *     read from those rows.
 *
 * What is stored. Page links, names as the page titles them, numbers, and the
 * requirement tables as the parser reads them (codes, credit cells and the
 * tables' own short row labels), exactly as the undergraduate and minor crawls
 * store them, because the reader needs those labels to tell "choose one" from
 * "take all". No paragraph of a page is stored; facts are written in our own
 * words. Footnote markers, email addresses and phone numbers are removed.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The index pages, in the order they are read. */
export const GRADUATE_INDEXES = [
  { path: '/graduate/', kind: 'degree' },
  { path: '/graduate/certificates/', kind: 'certificate' },
  { path: '/graduate/graduate-minors/', kind: 'minor' },
  { path: '/professional/', kind: 'professional' },
];

/** The cache file for a catalog path: "/graduate/las/history-ma/" is "graduate_las_history-ma.html". */
export const cacheNameOf = (path) => path.replace(/^\/|\/$/g, '').replace(/\//g, '_') + '.html';

/** The id of a page: its path without /graduate/ ("las/history-ma"), or "professional/law-jd". */
export const graduateIdOf = (path) => path.replace(/^\/graduate\//, '').replace(/^\//, '').replace(/\/$/, '');

/**
 * A link as the index prints it, made a path. Index links carry traps:
 * "index.html#text" suffixes on two certificates, a missing trailing slash
 * (/graduate/las/policy-economics-ms), and one href that ends in " /" and
 * 404s on Illinois's own site (Molecular & Cellular Biology MS); spaces are
 * trimmed so it is at least tried.
 */
export function normalisePath(href) {
  let p = String(href).trim().replace(/#.*$/, '').replace(/index\.html$/, '').replace(/\s+\/$/, '/').replace(/\s+/g, '');
  if (!p.endsWith('/')) p += '/';
  return p;
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#8203;/g, '').replace(/&#39;|&rsquo;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** The page's main content, where its program links are (not the menus). */
function contentOf(html) {
  const start = html.indexOf('id="textcontainer"');
  const end = html.indexOf('</main>', start);
  return start >= 0 ? html.slice(start, end > start ? end : undefined) : html;
}

/**
 * Every program link on an index page, with the links nested under it.
 *
 * The degree index is one list per letter: each degree is a top-level item
 * and its concentrations are a list inside it. Depth is counted from the
 * <ul> tags, so a concentration shared by twenty degrees is listed under each
 * of them and kept once per parent.
 */
export function graduateLinks(indexHtml, kind) {
  const body = contentOf(indexHtml);
  const out = [];
  let depth = 0;
  let parent = null;
  const seen = new Set();
  for (const m of body.matchAll(/<ul\b[^>]*>|<\/ul>|<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = m[0];
    if (/^<ul/i.test(tag)) { depth += 1; continue; }
    if (/^<\/ul/i.test(tag)) { depth = Math.max(0, depth - 1); continue; }
    const href = m[1] ?? '';
    if (!/^\s*\/(graduate|professional)\//.test(href) || /\.pdf\b/i.test(href)) continue;
    const path = normalisePath(href);
    const name = decode(m[2] ?? '');
    // The index pages themselves and their siblings are navigation.
    if (GRADUATE_INDEXES.some((i) => i.path === path) || /^\/graduate\/(concentrations|joint-degree-programs|online-programs)\/$/.test(path)) continue;
    if (path.split('/').filter(Boolean).length < 2) continue;
    if (kind === 'degree' && depth >= 2 && parent) {
      parent.nested.push({ path, name });
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    const link = { path, name, kind, nested: [] };
    out.push(link);
    parent = link;
  }
  return out;
}

/**
 * The degree as the name prints it, after the last comma: "Computer Science,
 * MCS" is MCS, "Architectural Studies, MS (post professional)" is MS. Null
 * for a name with none (a track printed at the top of the index).
 */
export function degreeOf(name) {
  const n = String(name).replace(/&#8217;|’/g, "'");
  const m = n.match(/,\s*([A-Za-z][A-Za-z.\- ]{0,30}?)\s*(?:\([^)]*\))?\s*(?:[-–]\s*[^,]*)?$/);
  // "Geographic Information Science - Professional Science Master's" names no degree, but a PSM is an MS.
  if (!m) return /professional science master/i.test(n) ? 'MS' : null;
  const d = m[1].replace(/\./g, '').trim();
  if (/^artist diploma$/i.test(d)) return 'AD';
  if (!/^[A-Z][A-Za-z-]{1,8}$/.test(d)) return null;
  return d;
}

const DOCTORAL = /^(PHD|EDD|DMA|DSW|JSD|AUD|DNP|DRPH|DPT)$/i;
const OTHER_GRADUATE = /^(CAS|AD)$/i;

/** masters / doctoral / other, from the degree code. */
export function kindOfDegree(degree) {
  if (!degree) return null;
  if (DOCTORAL.test(degree)) return 'doctoral';
  if (OTHER_GRADUATE.test(degree)) return 'other';
  return 'masters';
}

/** Footnote markers out, so they never stick to a title or an hours cell. */
export const withoutFootnoteMarks = (html) => html.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '');

const CONTACT = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\(?\b\d{3}\)?[ .-]\d{3}-\d{4}\b/g;
const scrub = (s) => (typeof s === 'string' ? s.replace(CONTACT, ' ').replace(/\s+/g, ' ').trim() : s);

/**
 * The requirements section of a page: from the degree-requirements container
 * to the next container that is not another course list. Null when the page
 * has no requirements section (DVM).
 */
export function requirementsHtml(html) {
  const ids = [...html.matchAll(/id="([a-z]*)textcontainer"/g)].map((m) => ({ id: m[1], at: m.index }));
  const start = ids.find((x) => /^(degreerequirements|requirements|programrequirements)$/.test(x.id));
  if (!start) return null;
  const end = ids.find((x) => x.at > start.at && !/courselist/.test(x.id));
  return html.slice(start.at, end ? end.at : undefined);
}

/** "12-16" is 12 to 16, "32 or 36" is 32 to 36, "0 or 4" is 0 to 4, "4" is 4. */
export function hoursRange(textValue) {
  const t = String(textValue ?? '').replace(/\s+/g, ' ').trim();
  const nums = [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]));
  if (nums.length === 0) return null;
  const range = t.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|to|or)\s*(\d+(?:\.\d+)?)/);
  if (range) return { min: parseFloat(range[1]), max: parseFloat(range[2]) };
  return { min: nums[0], max: nums[0] };
}

/**
 * A whole-table total row's label: "Total Hours", "Total", "Total hours (Minimum
 * Required)", "Minimum Total Hours", "Total Hours Required for Graduation",
 * "Minimum Hours for Degree", "Total Hours Required: 32" (the number in the
 * label, no hours cell). Subtotals name what they count ("Total hours core
 * courses", "Total Finance (FIN) Hours") and do not match.
 */
const TABLE_TOTAL = /^(?:(?:minimum\s+)?total(?:\s+(?:required\s+)?(?:credit\s+|semester\s+)?hours?)?(?:\s*\(minimum(?:\s+required)?\))?(?:\s+(?:for the degree|required(?: for (?:graduation|the degree))?|to graduate|for graduation))?|minimum (?:credit )?hours (?:for|required for) (?:the )?(?:degree|certificate|minor)(?: completion)?)\s*:?\s*(\d{1,3})?$/i;
/** The number a total label carries in its own words ("Total Hours Required: 32"). */
const totalInLabel = (label) => {
  const m = String(label ?? '').trim().match(TABLE_TOTAL);
  return m && m[1] ? { min: Number(m[1]), max: Number(m[1]) } : null;
};
/** Any total-like label, subtotals included ("Total hours core courses"). */
const ANY_TOTAL = /^(?:minimum\s+)?total\b/i;

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const numberOf = (w) => NUMBER_WORDS[String(w).toLowerCase()] ?? (Number.isFinite(Number(w)) ? Number(w) : null);

/**
 * The rules table, read into numbers and flags.
 *
 * Rows are [requirement, value]; the value may be in its own cell ("Minimum
 * GPA: | 3.0") or in the sentence ("The minimum program GPA is 3.0", "A
 * minimum of 12 500-level credit hours overall").
 */
export function readRules(rows) {
  const rules = {
    min500Hours: null, min500Text: null, minGpa: null, totalCredits: null, campusHours: null,
    maxTermHours: null, concentrationRequired: null, nonThesisOnly: false, thesisOnly: false,
    length: null, maxTransferHours: null,
  };
  for (const [label, value] of rows) {
    const both = `${label} ${value ?? ''}`.replace(/\s+/g, ' ').trim();
    let m;
    if ((m = both.match(/500[- ]level (?:credit )?hours? required overall:?\s*(\d{1,2})(?:\s*(?:or|-)\s*(\d{1,2}))?/i))) {
      rules.min500Hours = Number(m[1]); rules.min500Text = m[2] ? `${m[1]} or ${m[2]}` : null;
    } else if ((m = both.match(/minimum of (\d{1,2}) (?:credit hours of coursework at the 500[- ]level|500[- ]level (?:credit )?hours)/i)) && rules.min500Hours === null) {
      rules.min500Hours = Number(m[1]);
    }
    if ((m = both.match(/minimum (?:program |cumulative |overall )?C?GPA(?: is|:)?\s*(\d\.\d{1,2})/i))) rules.minGpa = Number(m[1]);
    if ((m = both.match(/^(?:minimum )?total (?:credit )?hours (?:for the degree|required)|^minimum total hours to graduate|^minimum hours required for (?:certificate|minor|degree)?\s*completion/i))) {
      const r = hoursRange(value || both.replace(/^[^\d]*/, ''));
      if (r) rules.totalCredits = r.min;
    }
    if ((m = both.match(/(?:minimum of |all )?(\d{1,2}) (?:[A-Z]{2,4} )?(?:graduate )?(?:credit |semester )?hours?(?: of [^.]{0,40})? must be (?:taken|completed|earned) (?:from|at|in residence at) the University of Illinois/i))) rules.campusHours = Number(m[1]);
    if ((m = both.match(/maximum credit hours allowed in a semester:?\s*(\d{1,2})/i))) rules.maxTermHours = Number(m[1]);
    if (/\bconcentration is required\b|\bmust (?:apply to and )?(?:choose|select|complete) (?:a|one) (?:graduate )?concentration\b/i.test(both)) rules.concentrationRequired = true;
    if (/\bconcentration is not required\b/i.test(both)) rules.concentrationRequired = false;
    if (/\bnon-?thesis only\b/i.test(both)) rules.nonThesisOnly = true;
    if (/\bthesis is required\b|\bthesis option only\b/i.test(both)) rules.thesisOnly = true;
    if ((m = both.match(/\bat most,? (\d{1,2}) (?:semester )?(?:credit )?hours of (?:previous )?graduate course ?work may be transferred/i))) rules.maxTransferHours = Number(m[1]);
    if (!rules.length && (m = both.match(/\bcompleted within (\w+) consecutive (?:\w+ )?(semesters|terms|years)/i)) && numberOf(m[1])) {
      rules.length = { value: numberOf(m[1]), unit: m[2].toLowerCase().replace('terms', 'semesters'), kind: 'within' };
    } else if (!rules.length && (m = both.match(/\bin residence (\w+) (semesters|years)/i)) && numberOf(m[1])) {
      rules.length = { value: numberOf(m[1]), unit: m[2].toLowerCase(), kind: 'residence' };
    } else if (!rules.length && (m = both.match(/\bminimum months to graduation:?\s*(\d{1,3})/i))) {
      rules.length = { value: Number(m[1]), unit: 'months', kind: 'minimum' };
    }
  }
  return rules;
}

/** "The program generally takes two years" and the like, in the page's lead paragraphs. */
export function typicalLengthIn(flat) {
  const m = flat.match(/\b(?:generally|typically|normally|usually) (?:takes?|completed? in|requires?) (?:about |approximately |around )?(\w+)(?: \(\d+\))? (?:full[- ]time )?(semesters|years|terms)\b/i);
  if (m && numberOf(m[1])) return { value: numberOf(m[1]), unit: m[2].toLowerCase().replace('terms', 'semesters'), kind: 'typical' };
  const n = flat.match(/\bcan be completed in (\w+)(?: \(\d+\))? (semesters|years)\b/i);
  if (n && numberOf(n[1])) return { value: numberOf(n[1]), unit: n[2].toLowerCase(), kind: 'typical' };
  return null;
}

/**
 * One course-list table's groups, with hour buckets and total rows taken out
 * of the comment rows they arrive as.
 *
 *   - a comment row labelled as the table's total ("Total Hours 44-56") or a
 *     heading row that is ("Total hours (Minimum Required) 48") becomes the
 *     table's total;
 *   - a comment row with hours and no course rows under it becomes a group of
 *     its own with no courses: an hour bucket, keeping its hours range;
 *   - a comment row with no hours and no rows under it, right after a bucket,
 *     qualifies that bucket ("Does not include CS 597 nor CS 591") and goes in
 *     its note;
 *   - everything else stays where the parser put it.
 */
export function splitBuckets(area) {
  let total = area.hoursFrom === 'table' ? { min: area.hours, max: area.hours } : null;
  const groups = [];
  const rules = [];
  for (let group of area.groups) {
    if ((group.courses?.length ?? 0) === 0 && TABLE_TOTAL.test((group.label ?? '').trim()) && (group.hours != null || totalInLabel(group.label))) {
      total = group.hours != null ? { min: group.hours, max: group.hours } : totalInLabel(group.label);
      // Comment rows under the total heading still belong to the table.
      if ((group.comments ?? []).length === 0) continue;
      group = { ...group, label: '', hours: null };
    }
    if ((group.courses?.length ?? 0) === 0 && (group.comments ?? []).length === 0 && RULE_ROW.test((group.label ?? '').trim())) {
      rules.push([group.label, group.hours != null ? String(group.hours) : '']);
      continue;
    }
    const comments = group.comments ?? [];
    if (comments.length === 0) { groups.push(group); continue; }
    const kept = [];
    const buckets = [];
    let last = null;
    comments.forEach((c, k) => {
      const nextAt = k + 1 < comments.length ? comments[k + 1].at : group.courses.length;
      const rowsAfter = nextAt - c.at;
      const range = c.hoursText ? hoursRange(c.hoursText) : null;
      if (TABLE_TOTAL.test(c.text.trim()) && (range || totalInLabel(c.text))) { total = range ?? totalInLabel(c.text); last = null; return; }
      if (RULE_ROW.test(c.text.trim()) && rowsAfter === 0) { rules.push([c.text, c.hoursText ?? '']); last = null; return; }
      if (rowsAfter === 0 && range && !ANY_TOTAL.test(c.text.trim())) {
        last = {
          label: c.text, choose: null, chooseFrom: null, hours: range.min, hoursMax: range.max, hoursText: c.hoursText,
          courses: [], note: '', comments: [], summedCredits: 0, kind: 'unknown', bucket: true,
        };
        buckets.push(last);
        return;
      }
      if (rowsAfter === 0 && !range && last && c.at === group.courses.length) {
        last.note = last.note ? `${last.note} ${c.text}` : c.text;
        return;
      }
      if (rowsAfter === 0 && !range && last && k > 0 && comments[k - 1].at === c.at) {
        last.note = last.note ? `${last.note} ${c.text}` : c.text;
        return;
      }
      last = null;
      kept.push(c);
    });
    const hasOwn = group.courses.length > 0 || kept.length > 0 || (group.label ?? '').trim();
    if (hasOwn) groups.push({ ...group, comments: kept, note: kept.map((c) => c.text).join(' ') });
    groups.push(...buckets);
  }
  return { area: { ...area, groups }, total, rules };
}

/** Rows of an sc_sctable as [first cell, second cell] text. */
function tableRows(tableHtml, text) {
  const rows = [];
  for (const r of tableHtml.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
    if (/sctablehead|hidden/.test(r[1])) continue;
    const cells = [...r[2].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1]));
    if (cells.length === 0 || !cells.join('').trim()) continue;
    rows.push([cells[0] ?? '', cells[1] ?? '']);
  }
  return rows;
}

/** The last heading before a table, as parseTables finds it. */
function headingBefore(before, text) {
  const heads = [...before.matchAll(/<(h2|h3|h4|p)[^>]*>([\s\S]{3,300}?)<\/(?:h2|h3|h4|p)>/gi)]
    .map((m) => text(m[2]))
    .filter((t) => t.length >= 3 && t.length <= 120 && /[a-z]/i.test(t));
  return heads.length ? heads[heads.length - 1] : '';
}

/** A row of a requirements table that is a rule, not hours to take. */
const RULE_ROW = /^(?:other requirements|minimum (?:program |cumulative )?c?gpa|minimum 500|minimum (?:credit )?hours (?:required )?(?:within|taken|at|from)|minimum credit hours taken|maximum\b|no more than|a minimum of \d+ (?:credit hours of coursework at the )?500|coursework must|no course|credit in\b)/i;

/** Headings that sit above an option's table without naming it. */
const NOT_AN_OPTION_NAME = /^(?:other requirements|for the\b|for additional|the requirements below|students need)/i;

/**
 * A total stated in a sentence above the tables: "Minimum hours required for
 * certificate completion: 12 hours", "a 3.0 GPA for a minimum of 32 graduate
 * hours", "requires a minimum of 48 hours".
 */
export function totalSentenceIn(flat) {
  const pats = [
    /minimum (?:credit )?hours required for (?:certificate|minor|degree)?\s*completion:?\s*(\d{1,3})/i,
    /\bfor a minimum of (\d{2}) graduate hours\b/i,
    /\b(?:program|degree|certificate|minor) requires (?:a minimum of |at least )?(\d{2}) (?:graduate |credit |semester )*hours\b/i,
  ];
  for (const re of pats) { const m = flat.match(re); if (m) return Number(m[1]); }
  return null;
}

/** Words a heading uses when its table is one of several the student picks from. */
export const OPTION_HEADING = /\b(?:thesis|non-?thesis|option|entering|track|plan [ab12]|with(?:out)? (?:an? |the )?(?:approved )?(?:b\.?s\.?|m\.?s\.?|b\.?a\.?|bachelor|master|bsw|msw|graduate degree|prior|previous)|route|path(?:way)?|advanced standing|full[- ]time|part[- ]time|on[- ]campus|online|students? (?:who|entering|with|without))\b/i;

/**
 * Read one program page.
 *
 * Returns the options (one when the page offers no choice), each with its
 * own areas and total; the rules; and how the page is written ('tables',
 * 'rules-only' or 'none').
 */
export function readGraduatePage(html, { parseTables, text }) {
  const req = requirementsHtml(html);
  const flatAll = text(withoutFootnoteMarks(html));
  if (!req) return { shape: 'none', options: [], rules: readRules([]), typicalLength: typicalLengthIn(flatAll) };
  const clean = withoutFootnoteMarks(req);
  const tables = [...clean.matchAll(/<table class="(sc_courselist|sc_sctable[^"]*)"[\s\S]*?<\/table>/g)];
  const parts = [];
  let ruleRows = [];
  let prevEnd = 0;
  for (const t of tables) {
    const before = clean.slice(prevEnd, t.index);
    const heading = headingBefore(before, text);
    if (t[1] === 'sc_courselist' && /^other requirements/i.test(heading)) {
      // A rules table printed as a course list: its rows are rules.
      ruleRows = ruleRows.concat(tableRows(t[0], text));
    } else if (t[1] === 'sc_courselist') {
      const areas = parseTables(before + t[0]);
      const area = areas[0] ?? { label: heading || null, labelKnown: Boolean(heading), hours: null, hoursFrom: null, chooseCourses: null, groups: [] };
      const { area: split, total, rules: inTable } = splitBuckets(area);
      ruleRows = ruleRows.concat(inTable);
      parts.push({ heading, area: { ...split, label: scrub(split.label) }, total });
    } else if (/other/i.test(t[1]) || /^other requirements/i.test(heading)) {
      ruleRows = ruleRows.concat(tableRows(t[0], text));
    } else {
      // Requirements printed as rules rows (ECE MEng): each sized row is a
      // bucket, and a row that is a rule (a minimum GPA, a 500-level minimum,
      // hours to take on campus) is a rule, wherever the page prints it.
      const rows = tableRows(t[0], text);
      let total = null;
      const groups = [];
      for (const [label, value] of rows) {
        const range = hoursRange(value);
        if (/^total\b/i.test(label) && range) { total = range; continue; }
        if (RULE_ROW.test(label)) { ruleRows.push([label, value]); continue; }
        if (!range || range.max === 0) continue;
        groups.push({ label, choose: null, chooseFrom: null, hours: range.min, hoursMax: range.max, hoursText: value, courses: [], note: '', comments: [], summedCredits: 0, kind: 'unknown', bucket: true });
      }
      if (groups.length) parts.push({ heading, area: { label: heading || null, labelKnown: Boolean(heading), hours: total?.min ?? null, hoursFrom: total ? 'table' : null, chooseCourses: null, groups }, total });
    }
    prevEnd = t.index + t[0].length;
  }
  const rules = readRules(ruleRows);
  const typicalLength = rules.length ?? typicalLengthIn(text(clean));
  if (parts.length === 0) return { shape: ruleRows.length ? 'rules-only' : 'prose-only', options: [], rules, typicalLength };

  // Options: two or more tables with their own totals, under headings that
  // name a choice, or all stating the same total (History MA: 32 and 32).
  const totalled = parts.filter((p) => p.total);
  const asOptions =
    totalled.length >= 2 &&
    (totalled.every((p) => OPTION_HEADING.test(p.heading)) ||
      totalled.every((p) => p.total.min === totalled[0].total.min && p.total.max === totalled[0].total.max));

  const options = [];
  if (asOptions) {
    // Each option is the run of tables that ends in a totalled table; a table
    // after the last total joins the last option.
    let run = [];
    for (const p of parts) {
      run.push(p);
      if (p.total) { options.push(run); run = []; }
    }
    if (run.length && options.length) options[options.length - 1].push(...run);
  } else {
    options.push(parts);
  }
  const sentence = totalSentenceIn(text(clean));
  const read = options.map((run, i) => {
    const last = [...run].reverse().find((p) => p.total);
    const total = asOptions
      ? last?.total ?? null
      : rules.totalCredits != null ? { min: rules.totalCredits, max: rules.totalCredits } : last?.total ?? (sentence != null ? { min: sentence, max: sentence } : null);
    // The table's own heading as the parser reads it (90 characters at most), so
    // a paragraph above a table never becomes an option's name.
    const heading = (run[0].area.label ?? '').trim() || ((run[0].heading ?? '').length <= 90 ? run[0].heading ?? '' : '');
    return {
      label: asOptions ? (heading && !NOT_AN_OPTION_NAME.test(heading) ? heading : `Option ${i + 1}`) : null,
      totalCredits: total?.min ?? null,
      totalMax: total && total.max !== total.min ? total.max : null,
      areas: run.map((p) => withoutContactsArea(p.area)),
    };
  });
  return { shape: 'tables', options: read, rules, typicalLength };
}

function withoutContactsArea(area) {
  return {
    ...area,
    label: /@/.test(area.label ?? '') ? '' : scrub(area.label),
    groups: area.groups.map((g) => ({
      ...g,
      label: scrub(g.label),
      note: scrub(g.note),
      ...(g.comments ? { comments: g.comments.map((c) => ({ ...c, text: scrub(c.text) })) } : {}),
      courses: g.courses.map((c) => ({ ...c, title: scrub(c.title) })),
    })),
  };
}

/** Thesis wording on the page: 'both', 'thesis', 'non-thesis' or null. */
export function thesisOf(flat, rules, options) {
  if (rules.nonThesisOnly) return 'non-thesis';
  const labels = options.map((o) => o.label ?? '').join(' ');
  if (/\bnon-?thesis\b/i.test(labels) && /\bthesis\b(?!\s*-)/i.test(labels.replace(/non-?thesis/gi, ''))) return 'both';
  if (/\bnon-?thesis\b/i.test(flat)) return /\bthesis (?:option|track)\b/i.test(flat) ? 'both' : 'non-thesis';
  if (/\b(?:thesis|dissertation)\b/i.test(flat)) return 'thesis';
  return null;
}

/** The page's own name, from <title>, without the catalog's suffixes. */
export function pageName(html, text, fallback) {
  const titleTag = text(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').split('|')[0].trim();
  return (titleTag || fallback || '').trim();
}

/** Facts in our own words, each with the page link. Never the page's sentences. */
export function factsFor(record) {
  const out = [];
  const r = record.rules;
  const say = (t) => out.push({ text: t, url: record.url });
  if (record.options.length > 1) say(`The page offers ${record.options.length} ways to complete it (${record.options.map((o) => `${o.totalCredits ?? '?'} hours`).join(', ')}); a student follows one.`);
  else if (record.options[0]?.totalCredits != null) say(`The page states a total of ${record.options[0].totalCredits}${record.options[0].totalMax ? ` to ${record.options[0].totalMax}` : ''} credit hours.`);
  if (r.min500Hours != null) say(`At least ${r.min500Text ?? r.min500Hours} of those hours must be in 500-level courses.`);
  if (r.minGpa != null) say(`The minimum program GPA is ${r.minGpa}.`);
  if (r.campusHours != null) say(`At least ${r.campusHours} hours must be earned at Urbana-Champaign.`);
  if (r.maxTransferHours != null) say(`No more than ${r.maxTransferHours} hours of earlier graduate work may transfer in.`);
  if (r.maxTermHours != null) say(`No more than ${r.maxTermHours} hours may be taken in one semester.`);
  if (r.concentrationRequired) say('A concentration is required; its courses are on the concentration pages.');
  if (record.thesis === 'non-thesis') say('This degree has no thesis.');
  if (record.thesis === 'both') say('The page offers a thesis route and a non-thesis route.');
  if (record.typicalLength) {
    const L = record.typicalLength;
    say(L.kind === 'within' ? `The page sets a limit of ${L.value} ${L.unit} to finish.` : L.kind === 'residence' ? `The page asks for ${L.value} ${L.unit} in residence.` : L.kind === 'minimum' ? `The page sets a minimum of ${L.value} ${L.unit} to graduate.` : `The page says the program usually takes ${L.value} ${L.unit}.`);
  }
  return out;
}

/**
 * Crawl every graduate and professional page the index pages list.
 *
 *   out:   the folder to write crawl.json into
 *   cache: read pages saved here, fetch and save the ones missing (optional)
 */
export async function crawlGraduate({ get, sleep, parseTables, text, BASE, DELAY, out, cache = null, log = console.log }) {
  let fetched = 0;
  let fromCache = 0;
  const fetchPage = async (path) => {
    const file = cache ? join(cache, cacheNameOf(path)) : null;
    if (file && existsSync(file)) { fromCache += 1; return readFileSync(file, 'utf8'); }
    const html = await get(BASE + path);
    await sleep(DELAY);
    fetched += 1;
    if (html && file) { mkdirSync(cache, { recursive: true }); writeFileSync(file, html); }
    return html;
  };

  const links = [];
  for (const index of GRADUATE_INDEXES) {
    const html = await fetchPage(index.path);
    if (!html) throw new Error(`the index page ${index.path} could not be read`);
    const found = graduateLinks(html, index.kind);
    log(`${String(found.length).padStart(4)} links on ${index.path}`);
    links.push(...found);
  }

  const programs = [];
  const skipped = [];
  const read = async (link, kind, extra = {}) => {
    const html = await fetchPage(link.path);
    if (!html) { skipped.push({ path: link.path, why: 'not read (the link fails on the catalog itself)' }); return null; }
    const name = pageName(html, text, link.name);
    const page = readGraduatePage(html, { parseTables, text });
    const segs = link.path.split('/').filter(Boolean);
    const degree = kind === 'certificate' ? 'GCRT' : kind === 'minor' ? 'MINOR' : kind === 'concentration' ? null : degreeOf(link.name) ?? degreeOf(name);
    const record = {
      id: graduateIdOf(link.path),
      kind: kind === 'degree' ? kindOfDegree(degree) : kind,
      college: segs[0] === 'professional' ? 'professional' : segs[1],
      name,
      degree,
      url: BASE + link.path,
      shape: page.shape,
      options: page.options,
      rules: page.rules,
      thesis: null,
      typicalLength: page.typicalLength,
      concentrations: (link.nested ?? []).map((n) => ({ id: graduateIdOf(n.path), name: n.name })),
      courseCount: new Set(page.options.flatMap((o) => o.areas.flatMap((a) => a.groups.flatMap((g) => g.courses.map((c) => c.code))))).size,
      ...extra,
    };
    record.thesis = thesisOf(text(withoutFootnoteMarks(requirementsHtml(html) ?? '')), page.rules, page.options);
    if (record.rules.concentrationRequired == null) {
      const flat = text(requirementsHtml(html) ?? '');
      if (/\b(?:must|required to) (?:apply to and complete|choose|select) (?:a|one) (?:graduate )?concentration\b|\bselect one concentration\b|\bmust choose a concentration\b/i.test(flat)) record.rules.concentrationRequired = true;
    }
    record.facts = factsFor(record);
    programs.push(record);
    log(`${String(programs.length).padStart(4)} ${String(record.courseCount).padStart(3)} courses  ${String(record.options.length)} option(s)  total ${record.options.map((o) => o.totalCredits ?? '?').join('/')}  ${record.shape.padEnd(10)} ${name.slice(0, 60)}`);
    return record;
  };

  for (const link of links) {
    if (link.kind === 'degree') {
      const degree = degreeOf(link.name);
      // A name with no degree is a track printed at the top of the index; it is read under its degree, if at all.
      if (!degree) { skipped.push({ path: link.path, why: 'a track or concentration printed at the top of the index' }); continue; }
    }
    await read(link, link.kind);
  }

  // Concentration pages of degrees that require one: their courses are the degree's.
  const wanted = new Map();
  for (const p of programs) {
    if (!p.rules.concentrationRequired) continue;
    const link = links.find((l) => graduateIdOf(l.path) === p.id);
    for (const n of link?.nested ?? []) {
      const id = graduateIdOf(n.path);
      const seen = wanted.get(id) ?? { link: { path: n.path, name: n.name, nested: [] }, parents: [] };
      seen.parents.push(p.id);
      wanted.set(id, seen);
    }
  }
  for (const { link, parents } of wanted.values()) await read(link, 'concentration', { parents });

  const byKind = programs.reduce((a, p) => ((a[p.kind] = (a[p.kind] ?? 0) + 1), a), {});
  log(`\n${programs.length} pages read (${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')}); ${fetched} fetched, ${fromCache} from the cache`);
  if (skipped.length) log(`  left out: ${skipped.length} (${skipped.slice(0, 6).map((s) => `${s.path}: ${s.why}`).join('; ')}${skipped.length > 6 ? '; ...' : ''})`);

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'crawl.json'), JSON.stringify({
    school: 'illinois',
    source: BASE + '/graduate/',
    fetchedAt: new Date().toISOString(),
    programs,
    skipped,
  }));
  log(`wrote ${join(out, 'crawl.json')}`);
  return { programs, skipped };
}
