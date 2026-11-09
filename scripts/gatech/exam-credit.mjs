/**
 * What Georgia Tech grants for an AP or IB exam, from the catalog's own tables.
 *
 * Sources (the official 2026-2027 Georgia Tech Catalog, CourseLeaf):
 *   https://catalog.gatech.edu/academics/undergraduate/credit-tests-scores/advanced-placement-exams/
 *     one table: Subject | Course ("AP Score: 4 or 5 = BIOS 1107 and BIOS 1107L") | Hours, plus footnotes
 *   https://catalog.gatech.edu/academics/undergraduate/credit-tests-scores/international-baccalaureate-exams/
 *     one table: Subject (with HL/SL) | Exam Scores ("4-5") | Credit, plus two starred notes. It has
 *     no hours column, so hours come from each course's catalog entry:
 *   https://catalog.gatech.edu/coursesaz/<subject>/   ("BIOS 1107.  Principles of Biology I.  3 Credit Hours.")
 *
 * Writes public/gatech-exam-credit.json in the same shape as public/illinois-exam-credit.json:
 *   { school, source, sourceFile, policy, fetchedAt, entries: [{ kind, exam, level, score, courses,
 *     exemptOnly, credits, noCredit, raw }] }
 * one entry per exam, level and score. Scores below the lowest one the table names get an
 * explicit no-credit entry, so a student who scored a 3 is told "no credit" rather than nothing.
 * Raw pages are cached in data/gatech-raw/exam-credit/; a rerun parses the cache and only asks
 * the catalog again with --refresh.
 *
 * Run from anywhere:  node scripts/gatech/exam-credit.mjs [--refresh]
 *
 * Reading the tables:
 *   - "XXX" codes (HTS 1XXX, SPAN 3XXX) are Georgia Tech's elective credit, real hours in a
 *     subject with no particular course. They are kept as written, like Illinois's "HIST 1--".
 *   - The IB language rows name a list of languages and bare numbers ("2001, 2002, and 3XXX (3)").
 *     The table's own note says credit is in the corresponding language, so each language gets
 *     its own exam ("Spanish B", HL) with its subject code (SPAN 2001, ...).
 *   - Two AP rows are one exam: "Chemistry - Effective Summer 2010" (score 4) and "Chemistry"
 *     (score 5) are both AP Chemistry, so both are written as "Chemistry".
 *   - IB math names are spelled out ("A&A" is Analysis and Approaches, "A&I" Applications and
 *     Interpretation) because that is what the student's score report says.
 *
 * What it cannot know:
 *   - Which year's table applies to a student. The catalog shows only the current one, so
 *     the policy line names the catalog edition and the planner should say so.
 *   - Credit that needs a later step. AP Physics C at a 4 earns credit only after a School of
 *     Physics placement test, so it is written as no credit with that note.
 *   - Hours for an IB course the current catalog does not list (HEBW 2002, HIN 2002, and all
 *     of PORT 1001-2002 today). A second course of a year takes its first course's hours
 *     (HIN 2002 as HIN 2001), and the row says so; one with no listed sibling (Portuguese)
 *     is left out of `credits`, so the total understates rather than invents.
 *   - How the app prices overlapping exams. applyExamCredit learns a course's hours only from
 *     rows that grant it alone, and most GT rows grant a pair (BIOS 1107 + BIOS 1107L).
 *   - BuzzPort's transfer-equivalency tool, which GT calls the official record, needs a login
 *     and is not read.
 *
 * Politeness: honest user agent, 1.5 s between requests, retries with a back-off, robots.txt
 * (catalog.gatech.edu disallows /search/ and admin paths, none of which are read).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { UA, sleep } from '../illinois/polite-get.mjs';

const ROOT = new URL('../../', import.meta.url);
const RAW = new URL('data/gatech-raw/exam-credit/', ROOT);
const OUT = new URL('public/gatech-exam-credit.json', ROOT);
const CATALOG = 'https://catalog.gatech.edu';
const AP_PAGE = `${CATALOG}/academics/undergraduate/credit-tests-scores/advanced-placement-exams/`;
const IB_PAGE = `${CATALOG}/academics/undergraduate/credit-tests-scores/international-baccalaureate-exams/`;
const REFRESH = process.argv.includes('--refresh');
const DELAY = 1500;

/** The languages the IB rows name, by Georgia Tech subject code (catalog.gatech.edu/coursesaz/). */
const LANGUAGE_CODES = {
  Arabic: 'ARBC', Chinese: 'CHIN', French: 'FREN', German: 'GRMN', Hebrew: 'HEBW', Hindi: 'HIN',
  Japanese: 'JAPN', Korean: 'KOR', Persian: 'PERS', Portuguese: 'PORT', Russian: 'RUSS', Spanish: 'SPAN',
};

/* ---------------------------------------------------------------- fetching */

let last = 0;
async function get(url, file) {
  const path = new URL(file, RAW);
  if (!REFRESH && existsSync(path)) return readFileSync(path, 'utf8');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wait = last + DELAY - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(40_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!/<title>[^<]*Georgia Tech Catalog/i.test(text)) throw new Error('not a catalog page');
      mkdirSync(RAW, { recursive: true });
      writeFileSync(path, text);
      return text;
    } catch (e) {
      if (attempt === 3) throw new Error(`${url}: ${e.message}`);
      console.log(`  ${url}: ${e.message}; waiting ${15 * 2 ** attempt}s`);
      await sleep(15_000 * 2 ** attempt);
    }
  }
  return null;
}

/* ----------------------------------------------------------------- parsing */

const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
/** Cell text, with footnote markers kept apart as `^n`. */
const text = (html) => decode(html.replace(/<sup>\s*([^<]*?)\s*<\/sup>/g, ' ^$1 ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/ ([.,;:])/g, '$1').trim();

function tableRows(html) {
  const table = html.match(/<table[^>]*sc_sctable[\s\S]*?<\/table>/);
  if (!table) return null;
  return [...table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((tr) => [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) => td[1]))
    .filter((cells) => cells.length >= 3);
}

/** AP footnotes, from the page's <dl class="sc_footnotes">. */
function footnotes(html) {
  const out = {};
  const dl = html.match(/<dl class="sc_footnotes"[\s\S]*?<\/dl>/);
  if (!dl) return out;
  for (const m of dl[0].matchAll(/<dt>\s*<sup>\s*(\d+)\s*<\/sup>\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) out[m[1]] = text(m[2]);
  return out;
}

/** "4 or 5", "4-5", "6-7", "5", "3 to 5" into whole scores. */
function scoresIn(cell) {
  const raw = cell.trim();
  const range = raw.match(/^(\d)\s*(?:-|to|–)\s*(\d)$/);
  if (range) return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i);
  const parts = raw.split(/\s*(?:,|\bor\b)\s*/i).filter(Boolean);
  if (parts.length && parts.every((p) => /^\d$/.test(p))) return parts.map(Number);
  return null;
}

/** "BIOS 1107 and BIOS 1107L", "CHIN 2001, CHIN 2002, and CHIN 3XXX", "HTS 1XXX". */
const CODE = /\b([A-Z]{2,5}) (\d[\dX]{3}[A-Z]?)\b/g;
const codesIn = (s) => [...s.matchAll(CODE)].map((m) => `${m[1]} ${m[2]}`);

const catalogHours = new Map();
const missingFromCatalog = new Set();
const variableHours = new Set();

const subjectLoads = new Map();
/** One load per subject, shared, so two courses priced at once never race the page. */
function loadSubject(subject) {
  if (!subjectLoads.has(subject)) subjectLoads.set(subject, readSubject(subject));
  return subjectLoads.get(subject);
}

async function readSubject(subject) {
  const page = await get(`${CATALOG}/coursesaz/${subject.toLowerCase()}/`, `coursesaz-${subject.toLowerCase()}.html`);
  if (!page) { console.log(`  no catalog page for ${subject}`); return; }
  for (const m of page.matchAll(/<p class="courseblocktitle"><strong>([\s\S]*?)<\/strong><\/p>/g)) {
    const t = text(m[1]);
    const head = t.match(/^([A-Z]{2,5}) (\d{4}[A-Z]?)\.\s/);
    const hours = t.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s+Credit Hours?\.?\s*$/i);
    if (!head || !hours) continue;
    const code = `${head[1]} ${head[2]}`;
    if (hours[2]) variableHours.add(`${code} (${hours[1]}-${hours[2]})`);
    catalogHours.set(code, Number(hours[1]));
  }
}

const inferredHours = new Map();
/**
 * Hours for a named course from the catalog, or null when the catalog does not list it.
 *
 * The IB language rows grant the second course of a year the catalog no longer lists for some
 * languages (HEBW 2002, HIN 2002). Its hours are taken from the first course of the same year,
 * which the catalog does list, and the row says so. A course with no listed sibling (Portuguese
 * has no 1001-2002 at all) stays unpriced: understating credit is safer than inventing it.
 */
async function hoursOf(code) {
  await loadSubject(code.split(' ')[0]);
  if (catalogHours.has(code)) return catalogHours.get(code);
  missingFromCatalog.add(code);
  const second = code.match(/^([A-Z]{2,5}) (\d)002$/);
  const sibling = second && `${second[1]} ${second[2]}001`;
  if (sibling && catalogHours.has(sibling)) {
    inferredHours.set(code, `${code} is not in the current catalog; its hours are taken as ${sibling}'s (${catalogHours.get(sibling)})`);
    return catalogHours.get(sibling);
  }
  return null;
}

const plural = (n) => `${n} ${n === 1 ? 'hour' : 'hours'}`;
const grantLine = (courses, credits) => `${courses.join(', ')}, ${plural(credits)}`;

/* -------------------------------------------------------------------- AP */

const entries = [];
const problems = [];

const apHtml = await get(AP_PAGE, 'ap.html');
const ibHtml = await get(IB_PAGE, 'ib.html');
if (!apHtml || !ibHtml) { console.error('The AP or IB page did not load. Nothing written.'); process.exit(1); }
const edition = (apHtml.match(/(\d{4}-\d{4})\s+Edition/) ?? [])[1] ?? null;

const apRows = tableRows(apHtml);
const apNotes = footnotes(apHtml);
if (!apRows || apRows.length < 30) { console.error(`AP table not found or short (${apRows?.length ?? 0} rows). Nothing written.`); process.exit(1); }
const apGrants = new Map(); // exam -> [{ scores, courses, credits, notes, cell }]
let subject = null;
for (const [c0, c1, c2] of apRows) {
  const name = text(c0);
  if (name) subject = name.replace(/\s*-\s*Effective Summer 2010$/i, '');
  if (!subject) continue;
  const cell = text(c1);
  const hours = Number(text(c2)) || 0;
  const marks = [...cell.matchAll(/\^(\d+)/g)].map((m) => m[1]);
  const notes = marks.map((n) => apNotes[n]).filter(Boolean);
  const list = apGrants.get(subject) ?? [];
  apGrants.set(subject, list);
  if (/no credit/i.test(cell)) { list.push({ scores: null, courses: [], credits: 0, notes, cell }); continue; }
  // Case-sensitive on purpose: with /i the "or" in "4 or 5 ID 2242" reads as a subject code.
  const m = cell.match(/^AP Score:?\s*(\d(?:\s*(?:,|or)\s*\d)*)\s*=?\s*([A-Z]{2,5} \d[\s\S]*)$/);
  const scores = m && scoresIn(m[1]);
  if (!scores) { problems.push(`AP ${subject}: could not read "${cell}"`); continue; }
  const courses = [...new Set(codesIn(m[2]))];
  list.push({ scores, courses, credits: hours, notes, cell });
}

for (const [exam, grants] of apGrants) {
  const credited = new Set(grants.flatMap((g) => g.scores ?? []));
  for (const g of grants) {
    if (!g.scores) continue;
    // Check the table's hours against the catalog wherever every course is a named one.
    if (g.courses.every((c) => !/X/.test(c))) {
      const sum = (await Promise.all(g.courses.map(hoursOf))).reduce((a, h) => a + (h ?? NaN), 0);
      if (!Number.isNaN(sum) && sum !== g.credits) problems.push(`AP ${exam} ${g.scores.join('/')}: table says ${g.credits} hours, catalog courses add to ${sum} (table kept)`);
    }
    for (const score of g.scores) {
      const notes = g.notes.filter((n) => !/score of 4 will be contacted/i.test(n) || score === 4);
      entries.push({ kind: 'AP', exam, level: null, score, courses: g.courses, exemptOnly: [], credits: g.credits, noCredit: g.credits === 0,
        raw: [grantLine(g.courses, g.credits), ...notes].join('. ').replace(/\.\./g, '.') });
    }
  }
  const physicsTest = grants.some((g) => g.notes.some((n) => /score of 4 will be contacted/i.test(n)));
  const lowest = Math.min(...credited);
  for (let score = 1; score <= 5; score += 1) {
    if (credited.has(score)) continue;
    let raw = credited.size === 0
      ? 'No credit. Georgia Tech awards no credit for this exam'
      : `No credit. Georgia Tech awards credit for this exam starting at a score of ${lowest}`;
    if (physicsTest && score === 4) raw = `No credit at a 4 until it is validated. ${apNotes['3'] ?? 'The School of Physics offers a placement test that validates the credit.'}`;
    entries.push({ kind: 'AP', exam, level: null, score, courses: [], exemptOnly: [], credits: 0, noCredit: true, raw });
  }
}

/* -------------------------------------------------------------------- IB */

const ibRows = tableRows(ibHtml);
if (!ibRows || ibRows.length < 30) { console.error(`IB table not found or short (${ibRows?.length ?? 0} rows). Nothing written.`); process.exit(1); }
const ibStars = [...ibHtml.matchAll(/<h6>([\s\S]*?)<\/h6>/g)].map((m) => text(m[1])).filter((t) => t.startsWith('*'));
const oneStar = ibStars.find((t) => /^\*[^*]/.test(t))?.replace(/^\*\s*/, '') ?? null;

const IB_NAMES = { 'A&A': 'Analysis and Approaches', 'A&I': 'Applications and Interpretation' };
const ibGrants = new Map(); // `${exam}|${level}` -> { exam, level, grants: [] }
let current = null;
for (const [c0, c1, c2] of ibRows) {
  const name = text(c0);
  if (name) {
    const lang = name.match(/^\*\*Foreign Language (A: Language and Literature|A: Literature|B):?\s*(HL|SL)\s*\(([^)]*)\)/i);
    if (lang) {
      const languages = lang[3].split(',').map((s) => s.trim()).filter(Boolean);
      current = { languages, form: lang[1], level: lang[2].toUpperCase() };
    } else if (/^Foreign Language Ab Initio/i.test(name)) {
      current = { exam: 'Language ab initio (any language)', level: 'SL' };
    } else {
      const m = name.match(/^(.*?)[\s:]*\b(HL|SL)$/);
      if (!m) { problems.push(`IB: no HL/SL in "${name}"`); current = null; continue; }
      const exam = m[1].replace(/\b(A&A|A&I)\b/, (k) => IB_NAMES[k]).replace(/\s+/g, ' ').trim();
      current = { exam, level: m[2] };
    }
  }
  if (!current) continue;
  const scoreCell = text(c1);
  const creditCell = text(c2).replace(/\(\s*(\d+)\s*$/, '($1)'); // "3XXX (3" is missing its parenthesis
  const scores = scoreCell ? scoresIn(scoreCell) : null;
  if (scoreCell && !scores) { problems.push(`IB ${current.exam ?? current.form}: could not read score "${scoreCell}"`); continue; }
  const targets = current.languages
    ? current.languages.map((language) => ({ exam: `${language} ${current.form}`, level: current.level, subject: LANGUAGE_CODES[language], language }))
    : [{ exam: current.exam, level: current.level, subject: null }];
  for (const t of targets) {
    const key = `${t.exam}|${t.level}`;
    if (!ibGrants.has(key)) ibGrants.set(key, { exam: t.exam, level: t.level, grants: [] });
    if (/no credit/i.test(creditCell)) { ibGrants.get(key).grants.push({ scores: null, cell: creditCell }); continue; }
    if (current.languages && !t.subject) { problems.push(`IB ${t.exam}: no Georgia Tech subject code for ${t.language}`); continue; }
    // "2001, 2002, and 3XXX (3)" is in the language's own subject; "SS 1XXX (3)" names its subject.
    const pieces = creditCell.split(/\s*(?:,|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    const items = [];
    for (const piece of pieces) {
      const m = piece.match(/^(?:([A-Z]{2,5}) )?(\d[\dX]{3}[A-Z]?)\s*\*?(?:\s*\((\d+)\))?$/);
      if (!m) { problems.push(`IB ${t.exam}: could not read "${piece}" in "${creditCell}"`); continue; }
      const subj = m[1] ?? t.subject;
      if (!subj) { problems.push(`IB ${t.exam}: "${piece}" has no subject`); continue; }
      items.push({ code: `${subj} ${m[2]}`, hours: m[3] ? Number(m[3]) : null });
    }
    ibGrants.get(key).grants.push({ scores, items, cell: creditCell });
  }
}

for (const { exam, level, grants } of ibGrants.values()) {
  const credited = new Set();
  for (const g of grants) {
    if (!g.scores) continue;
    let credits = 0;
    const unpriced = [];
    for (const item of g.items) {
      const h = item.hours ?? (/X/.test(item.code) ? null : await hoursOf(item.code));
      if (h === null) unpriced.push(item.code); else credits += h;
    }
    const courses = [...new Set(g.items.map((i) => i.code))];
    const notes = [];
    if (/\*\s*$/.test(g.cell) && oneStar) notes.push(oneStar.replace(/\s+/g, ' '));
    for (const item of g.items) if (inferredHours.has(item.code)) notes.push(inferredHours.get(item.code));
    if (unpriced.length) notes.push(`${unpriced.join(', ')} ${unpriced.length === 1 ? 'is' : 'are'} not in the current catalog, so ${unpriced.length === 1 ? 'its hours are' : 'their hours are'} not counted here; the registrar posts the actual hours`);
    for (const score of g.scores) {
      credited.add(score);
      entries.push({ kind: 'IB', exam, level, score, courses, exemptOnly: [], credits, noCredit: credits === 0 && courses.length === 0,
        raw: [unpriced.length === 0 ? `${grantLine(courses, credits)} (hours from the course catalog)`
          : credits > 0 ? `${courses.join(', ')}, at least ${plural(credits)}` : `${courses.join(', ')}, hours unknown`, ...notes].join('. ') });
    }
  }
  const lowest = credited.size ? Math.min(...credited) : null;
  for (let score = 1; score <= 7; score += 1) {
    if (credited.has(score)) continue;
    entries.push({ kind: 'IB', exam, level, score, courses: [], exemptOnly: [], credits: 0, noCredit: true,
      raw: lowest === null
        ? `No credit. Georgia Tech awards no credit for ${exam} ${level}`
        : `No credit. Georgia Tech awards credit for ${exam} ${level} starting at a score of ${lowest}` });
  }
}

/* ------------------------------------------------------------------ write */

entries.sort((a, b) =>
  a.kind.localeCompare(b.kind) ||
  a.exam.localeCompare(b.exam) ||
  String(a.level ?? '').localeCompare(String(b.level ?? '')) ||
  String(a.score).localeCompare(String(b.score), undefined, { numeric: true }));

const out = {
  school: 'gatech',
  source: AP_PAGE,
  sourceFile: IB_PAGE,
  sourceFiles: [AP_PAGE, IB_PAGE],
  policy: `These are the credit policies in the ${edition ?? 'current'} Georgia Tech Catalog. All exams must be taken before a student enrolls at Georgia Tech.`,
  fetchedAt: new Date().toISOString(),
  entries,
};
writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);

const exams = new Set(entries.map((e) => `${e.kind}|${e.exam}|${e.level ?? ''}`));
const ap = [...exams].filter((k) => k.startsWith('AP|')).length;
console.log('public/gatech-exam-credit.json');
console.log(`  ${entries.length} score rows over ${exams.size} exams, ${ap} AP and ${exams.size - ap} IB (exam+level)`);
console.log(`  ${entries.filter((e) => !e.noCredit).length} rows grant credit, ${entries.filter((e) => e.noCredit).length} grant none`);
console.log(`  ${out.policy}`);
if (missingFromCatalog.size) console.log(`  named courses the catalog does not list: ${[...missingFromCatalog].sort().join(', ')}`);
for (const line of inferredHours.values()) console.log(`    ${line}`);
if (variableHours.size) console.log(`  variable-hour catalog courses (lowest used): ${[...variableHours].filter((v) => entries.some((e) => e.courses.includes(v.split(' (')[0]))).join(', ') || 'none granted'}`);
if (problems.length) { console.log(`  ${problems.length} notes:`); for (const p of problems) console.log(`    ${p}`); }
