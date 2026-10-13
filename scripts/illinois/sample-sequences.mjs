/**
 * Every Illinois program's official four-year sample sequence, as data.
 *
 * Each undergraduate program page in the catalog has a "Sample Sequence" tab:
 * the department's own semester-by-semester plan. It is the yardstick for the
 * planner's auto-built boards (scripts/dev/sweep/compare-sample.mjs), so this
 * script only records what each term holds; nothing in the product reads it.
 *
 * The tab is part of the same page the degree crawler reads
 * (catalog.illinois.edu/undergraduate/<college>/<program>/), inside
 * <div id="samplesequencetextcontainer">. Each term is one table:
 *
 *   <h3>First Year</h3>
 *   <table class="sc_plangrid"><caption><h4>First Semester</h4></caption>
 *     <tr><td class="codecol"><a>CS 124</a> - Title</td><td class="hourscol">3</td></tr>
 *     <tr><td class="codecol"><a>MATH 221</a> - Calculus I or <a>MATH 220</a> - Calculus</td>...
 *     <tr><td class="codecol">Free Elective course</td><td class="hourscol">3</td></tr>
 *
 * Some colleges print a year as one table with the two semesters side by side
 * (four columns: course, hours, course, hours); both layouts are read. A page
 * can carry more than one sequence (one per track or starting point); every
 * one is kept, and the first is the program's main sequence.
 *
 * What a row becomes (no page wording is stored, only codes, hours and kinds):
 *   - a named row: `options`, the choices the row allows ("MATH 221 or MATH
 *     220" is two options of one course each; "CHEM 102 & CHEM 103" is one
 *     option of two courses);
 *   - a slot: a placeholder the student fills (free elective, gen ed, language,
 *     major or technical elective). `slot` says which, `genEd` which gen-ed
 *     categories it names, and `suggests` any course codes it offers as
 *     examples ("Science elective (PHYS 211 recommended)").
 *
 * Polite: robots.txt allows /undergraduate/; one request every 1.1 s with the
 * project's user agent (polite-get.mjs).
 *
 * Usage:
 *   node scripts/illinois/sample-sequences.mjs [--cache <dir>] [--offline] [--only id,id] [--out <file>]
 *
 * --cache keeps each page's HTML in <dir> (outside the repo) so a parser change
 * can be re-run with --offline and no requests at all.
 *
 * Output: public/illinois/sample-sequences.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { politeGet, sleep } from './polite-get.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DELAY = 1100;

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const CACHE = opt('--cache');
const OFFLINE = args.includes('--offline');
const ONLY = opt('--only')?.split(',').filter(Boolean) ?? null;
const OUT = opt('--out') ?? join(ROOT, 'public', 'illinois', 'sample-sequences.json');

const ent = (s) => s
  .replace(/&#160;|&nbsp;/g, ' ').replace(/&#8194;|&ensp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&#8217;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
const text = (h) => ent(String(h).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const num = (s) => { const m = text(s).match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : null; };

/** The sample-sequence tab's HTML, or null when the page has none. */
export function sequenceTab(html) {
  const i = html.indexOf('id="samplesequencetextcontainer"');
  if (i < 0) return null;
  // The tab ends where the next tab panel starts.
  const rest = html.slice(i);
  const j = rest.slice(40).search(/<div[^>]*class="[^"]*tab_content/);
  return j < 0 ? rest : rest.slice(0, j + 40);
}

const CODE = /\b([A-Z]{2,4})\s?(\d{3})\b/g;
const codesIn = (s) => [...s.matchAll(CODE)].map((m) => `${m[1]} ${m[2]}`);
// Words that look like codes but are not subjects.
const NOT_SUBJECT = new Set(['OR', 'AND', 'THE', 'FOR', 'ALL', 'ANY', 'ONE', 'TWO', 'GPA', 'ACT', 'SAT', 'AP', 'IB']);

/** Gen-ed categories a slot names, in the catalog's own category words. */
function genEdTags(t) {
  const tags = [];
  if (/humanit|hum\b|literature|arts\b/i.test(t)) tags.push('humanities');
  if (/social|behavioral|behavioural|soc\/beh|sbs/i.test(t)) tags.push('social-behavioral');
  if (/natural science|nat sci|physical science|life science|science & tech/i.test(t)) tags.push('natural-science');
  if (/cultural stud|non-western|western\/comparative|us minority|u\.s\. minority/i.test(t)) tags.push('cultural-studies');
  if (/quantitative|\bqr\b/i.test(t)) tags.push('quantitative');
  if (/composition i\b|comp i\b|rhetoric/i.test(t)) tags.push('composition-1');
  if (/advanced composition|adv(?:anced)? comp\b/i.test(t)) tags.push('advanced-composition');
  return tags;
}

/**
 * Subjects the catalog knows, so a slot's "300-400 level ECON course" or "CMN
 * course" can say which subject it holds. Loaded lazily from the course index.
 */
let SUBJECTS = null;
function knownSubjects() {
  if (!SUBJECTS) {
    try {
      SUBJECTS = new Set(JSON.parse(readFileSync(join(ROOT, 'public', 'illinois', 'index.json'), 'utf8')).map((c) => c.code.split(' ')[0]));
    } catch { SUBJECTS = new Set(); }
  }
  return SUBJECTS;
}

/** Subject names a slot spells out instead of giving the code. */
const SUBJECT_NAMES = [
  [/art history/i, 'ARTH'], [/\beconomics\b/i, 'ECON'], [/\bcommunication\b/i, 'CMN'],
  [/\bmathematics\b/i, 'MATH'], [/\bstatistics\b/i, 'STAT'], [/\bpsycholog/i, 'PSYC'], [/medieval studies/i, 'MDVL'], [/\barchaeology\b/i, 'ANTH'],
  [/\bsociology\b/i, 'SOC'], [/(?<!art )\bhistory\b(?! of)/i, 'HIST'], [/\bphilosophy\b/i, 'PHIL'],
  [/\banthropology\b/i, 'ANTH'], [/\bchemistry\b/i, 'CHEM'], [/\bphysics\b/i, 'PHYS'],
  [/\blinguistics\b/i, 'LING'], [/political science/i, 'PS'], [/computer science/i, 'CS'],
  [/\bastronomy\b/i, 'ASTR'], [/\bgeology\b/i, 'GEOL'], [/\breligion\b/i, 'REL'],
  [/\bjournalism\b/i, 'JOUR'], [/\badvertising\b/i, 'ADV'], [/\bfinance\b/i, 'FIN'],
  [/\baccountancy\b|\baccounting\b/i, 'ACCY'], [/\bmusic\b/i, 'MUS'], [/\btheatre\b/i, 'THEA'],
  [/\bdance\b/i, 'DANC'], [/\bkinesiology\b/i, 'KIN'], [/\bclassics\b/i, 'CLCV'],
  [/integrative biology/i, 'IB'], [/molecular (?:and|&) cellular biology/i, 'MCB'],
  [/\bspanish\b/i, 'SPAN'], [/\bfrench\b/i, 'FR'], [/\bgerman\b/i, 'GER'], [/\bitalian\b/i, 'ITAL'],
  [/\bportuguese\b/i, 'PORT'], [/\brussian\b/i, 'RUSS'], [/\bjapanese\b/i, 'JAPN'], [/\bchinese\b/i, 'CHIN'],
  [/\bkorean\b/i, 'KOR'], [/\bgeography\b/i, 'GGIS'], [/\bstudio art\b/i, 'ARTS'],
  [/\bgraphic design\b|\bindustrial design\b/i, 'ARTD'], [/\bgender (?:and|&) women/i, 'GWS'],
];

/** Subjects a slot names, by code or by name. */
function slotSubjects(t) {
  const known = knownSubjects();
  const out = new Set();
  for (const m of t.matchAll(/\b([A-Z]{2,5})\b/g)) if (known.has(m[1]) && !NOT_SUBJECT.has(m[1])) out.add(m[1]);
  // Gen-ed and language slots name categories, not subjects.
  if (!/general education|gen ed|language other than english/i.test(t)) {
    for (const [re, code] of SUBJECT_NAMES) if (re.test(t)) out.add(code);
  }
  return [...out];
}

/** The lowest course level a slot allows ("300- or 400-level" -> 300). */
function slotLevel(t) {
  const m = t.match(/\b([1-5])00\s*(?:-|–|or|to)?\s*(?:(?:[1-5])00)?\s*-?\s*level\b/i) ?? t.match(/\b([1-5])(?:00|XX)\b/);
  return m ? Number(m[1]) * 100 : null;
}

/** What kind of placeholder a course-less row is. */
function slotKind(t) {
  const l = t.toLowerCase();
  if (/language other than english|foreign language|\blanguage\b|lote/.test(l)) return 'language';
  if (/free elective|general elective|elective hours|^electives?\b|open elective|unrestricted/.test(l) && !/technical|major|science elective|professional|concentration|focus|track|support/.test(l)) return 'free-elective';
  if (/technical elective|tech elective/.test(l)) return 'technical-elective';
  if (/general education|gen ed|humanit|social|behavioral|cultural stud|quantitative|natural science|composition|western|minority/.test(l)) return 'gened';
  if (/elective|selection|course from|choose|select|concentration|option|focus|track|area|list|course\b|courses\b/.test(l)) return 'major-elective';
  return 'other';
}

/**
 * One row of a term table. `cell` is the course cell's HTML.
 * A row that opens with a course code is a named row; anything else is a slot.
 */
export function readRow(cell, hoursCell) {
  const t = text(cell);
  if (!t) return null;
  const hours = num(hoursCell ?? '');
  // Codes from links first (the catalog links real courses), then plain text.
  const linked = [...cell.matchAll(/<a[^>]*title="([A-Z]{2,4})(?:&#160;|\s|%20)(\d{3})"/g)].map((m) => `${m[1]} ${m[2]}`);
  const plain = codesIn(t).filter((c) => !NOT_SUBJECT.has(c.split(' ')[0]));
  const codes = [...new Set([...linked, ...plain])];
  const optional = /\boptional\b/i.test(t);
  const startsWithCode = /^(?:or\s+)?[A-Z]{2,4}\s?\d{3}\b/.test(t);
  if (codes.length && startsWithCode) {
    // Split the row into its "or" alternatives, each of which may be an "&" pair.
    // Titles sit between codes ("MATH 221 - Calculus I or MATH 220 - Calculus"),
    // so split on the codes' positions, not on the word alone.
    const options = [];
    // A comma before a code lists another choice ("ACES 102 - Title, CMN 101 -
    // Title, or CMN 112 - Title").
    const pieces = t.split(/\s+or\s+|\s*\/\s*(?=[A-Z]{2,4}\s?\d{3})|,\s*(?=[A-Z]{2,4}\s?\d{3})/i);
    for (const piece of pieces) {
      const pc = codesIn(piece).filter((c) => !NOT_SUBJECT.has(c.split(' ')[0]));
      if (!pc.length) continue;
      // "CHEM 102 & CHEM 103": courses taken together. Only an "&" or "and"
      // right before a code joins courses; "Molecular & Cellular Basis of
      // Life" is a title.
      options.push(/(?:&|\band\b)\s*[A-Z]{2,4}\s?\d{3}/.test(piece) ? pc : [pc[0]]);
    }
    const kindWords = text(cell).replace(CODE, '');
    const slotish = /elective|gen(?:eral)? ed/i.test(kindWords) && options.length > 2;
    return {
      kind: 'course',
      options: options.length ? options : [[codes[0]]],
      hours,
      ...(optional ? { optional: true } : {}),
      ...(slotish ? { listLike: true } : {}),
    };
  }
  const slot = slotKind(t);
  const genEd = genEdTags(t);
  const subjects = slot === 'gened' || slot === 'language' || slot === 'free-elective' ? [] : slotSubjects(t);
  const level = slotLevel(t);
  return {
    kind: 'slot',
    slot,
    hours,
    ...(subjects.length ? { subjects } : {}),
    ...(level ? { level } : {}),
    ...(genEd.length ? { genEd } : {}),
    ...(codes.length ? { suggests: codes } : {}),
    ...(optional ? { optional: true } : {}),
  };
}

const YEAR_WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, freshman: 1, sophomore: 2, junior: 3, senior: 4 };
function yearOf(h) {
  const m = h.toLowerCase().match(/\b(first|second|third|fourth|fifth|freshman|sophomore|junior|senior)\b/);
  if (m) return YEAR_WORDS[m[1]];
  const d = h.match(/\byear\s*(\d)\b|\b(\d)(?:st|nd|rd|th)\s+year\b/i);
  return d ? parseInt(d[1] ?? d[2], 10) : null;
}
function seasonOf(h) {
  const l = h.toLowerCase();
  if (/summer/.test(l)) return 'summer';
  if (/\bfall\b|first semester|semester 1\b|1st semester/.test(l)) return 'fall';
  if (/spring|second semester|semester 2\b|2nd semester/.test(l)) return 'spring';
  return null;
}

/** Rows of one sc_plangrid table, split into one or two semesters. */
function readGrid(table) {
  const caption = text(table.match(/<caption>([\s\S]*?)<\/caption>/)?.[1] ?? '');
  const heads = [...(table.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]));
  const body = table.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? table;
  const foot = table.match(/<tfoot>([\s\S]*?)<\/tfoot>/)?.[1] ?? '';
  const footHours = [...foot.matchAll(/<td[^>]*class="[^"]*hourscol[^"]*"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => num(m[1]));
  const sideBySide = heads.length >= 4;
  const sems = sideBySide
    ? [{ head: heads[0], rows: [], hours: footHours[0] ?? null }, { head: heads[2], rows: [], hours: footHours[1] ?? null }]
    : [{ head: caption || heads[0] || '', rows: [], hours: footHours[0] ?? null }];
  // A plangrid's "Semester Hours" sometimes sits in the body.
  for (const rm of body.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
    const cls = rm[1];
    const cells = [...rm[2].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g)].map((m) => ({ attr: m[1], html: m[2] }));
    if (!cells.length) continue;
    if (/plangridsum|plangridtotal/.test(cls) || /semester hours|total hours/i.test(text(cells[0].html))) {
      if (sideBySide) { sems[0].hours ??= num(cells[1]?.html ?? ''); sems[1].hours ??= num(cells[3]?.html ?? cells[2]?.html ?? ''); }
      else sems[0].hours ??= num(cells[cells.length - 1].html);
      continue;
    }
    const pairs = sideBySide ? [[cells[0], cells[1]], [cells[2], cells[3]]] : [[cells[0], cells[1]]];
    pairs.forEach(([c, h], k) => {
      if (!c) return;
      const orRow = /orclass/.test(cls) || /^or\s/i.test(text(c.html));
      const row = readRow(c.html, h?.html);
      if (!row) return;
      const rows = sems[k].rows;
      // "or MATH 220" on its own row is another option of the row above.
      if (orRow && row.kind === 'course' && rows.length && rows[rows.length - 1].kind === 'course') {
        rows[rows.length - 1].options.push(...row.options);
        return;
      }
      rows.push(row);
    });
  }
  return sems;
}

/** Every sequence on the tab: [{ heading, terms: [{ year, season, index, hours, rows, summer? }] }]. */
export function readSequences(tab) {
  const seqs = [];
  let seq = null;
  let year = null;
  // Walk headings and tables in page order.
  const re = /<(h2|h3|h4|h5)[^>]*>([\s\S]*?)<\/\1>|<table[^>]*class="[^"]*sc_plangrid[^"]*"[^>]*>([\s\S]*?)<\/table>/g;
  let lastHeading = '';
  for (const m of tab.matchAll(re)) {
    if (m[1]) {
      const h = text(m[2]);
      if (!h || /^sample sequence$/i.test(h)) continue;
      const y = yearOf(h);
      if (y && h.length < 40 && /year|freshman|sophomore|junior|senior/i.test(h)) { year = y; continue; }
      // Any other heading names a new sequence (a track or a starting point),
      // once the current one already has terms.
      lastHeading = h;
      if (seq && seq.terms.length) { seqs.push(seq); seq = null; year = null; }
      continue;
    }
    const table = m[0];
    for (const sem of readGrid(table)) {
      if (!seq) seq = { heading: lastHeading ? 'named' : '', terms: [] };
      // "First Semester" names a semester, not a year: only a heading that
      // says "year" (or freshman, junior...) sets the year.
      const y = (/year|freshman|sophomore|junior|senior/i.test(sem.head) ? yearOf(sem.head) : null) ?? year;
      // A year that starts over means a second sequence on the same tab.
      const prev = seq.terms[seq.terms.length - 1];
      if (prev && y != null && prev.year != null && y < prev.year) { seqs.push(seq); seq = { heading: 'named', terms: [] }; }
      seq.terms.push({ year: y, season: seasonOf(sem.head), hours: sem.hours, rows: sem.rows });
    }
  }
  if (seq && seq.terms.length) seqs.push(seq);
  // Terms are numbered by their order on the page, not by their headings:
  // headings are missing on some pages ("First Semester" four times, no year)
  // and repeated on others ("Third Year" twice, "Second Semester" twice).
  // Index 0 is the first fall, 7 the fourth spring; a summer term keeps the
  // index of the spring before it and is marked as a summer.
  for (const s of seqs) {
    let n = -1;
    for (const t of s.terms) {
      if (t.season === 'summer') { t.index = Math.max(0, n); t.summer = true; t.year = Math.floor(Math.max(0, n) / 2) + 1; continue; }
      n += 1;
      t.index = n;
      t.year = Math.floor(n / 2) + 1;
      t.season = n % 2 ? 'spring' : 'fall';
    }
  }
  return seqs;
}

/** Why a page with no plan grid has none, in a few words. */
function noneReason(tab) {
  if (!tab) return 'no sample sequence tab';
  const t = text(tab);
  if (/sc_courselist/.test(tab)) return 'tab uses a course list, not a term grid';
  if (t.length < 250) return 'tab is empty or a link only';
  return 'tab has text but no term grid';
}

async function main() {
  const src = JSON.parse(readFileSync(join(ROOT, 'public', 'illinois-programs.json'), 'utf8'));
  let programs = src.programs.map((p) => ({ id: p.id, name: p.name, degree: p.degree, url: p.url }));
  if (ONLY) programs = programs.filter((p) => ONLY.includes(p.id));
  if (CACHE) mkdirSync(CACHE, { recursive: true });
  const out = [];
  let fetched = 0;
  // When pages come from the cache, the date is when they were fetched.
  let oldest = null;
  for (const [n, p] of programs.entries()) {
    const file = CACHE ? join(CACHE, p.id.replace(/\//g, '__') + '.html') : null;
    let html = file && existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (html) { const t = statSync(file).mtime; if (!oldest || t < oldest) oldest = t; }
    if (!html && !OFFLINE) {
      if (fetched) await sleep(DELAY);
      html = await politeGet(p.url, { waits: [15_000, 30_000, 60_000] });
      fetched += 1;
      if (html && file) writeFileSync(file, html);
    }
    if (!html) { out.push({ id: p.id, url: p.url, read: false, sequences: [], none: 'page not read' }); continue; }
    const tab = sequenceTab(html);
    const seqs = tab ? readSequences(tab) : [];
    const entry = { id: p.id, url: p.url + '#samplesequencetext', read: true };
    if (!seqs.length) entry.none = noneReason(tab);
    entry.sequences = seqs;
    // Hours the sequence adds up to, from its own term totals.
    if (seqs.length) entry.totalHours = seqs[0].terms.reduce((a, t) => a + (t.hours ?? 0), 0) || null;
    out.push(entry);
    if ((n + 1) % 25 === 0) console.log(`${n + 1}/${programs.length} (${fetched} fetched)`);
  }
  const doc = {
    school: 'illinois',
    source: 'https://catalog.illinois.edu/undergraduate/ (each program page, Sample Sequence tab)',
    fetchedAt: (oldest ?? new Date()).toISOString(),
    note: 'Department sample four-year sequences, as course codes, hours and slot kinds per term. Read by scripts/dev/sweep/compare-sample.mjs only.',
    programs: out,
  };
  if (!ONLY) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(doc) + '\n');
  }
  const withSeq = out.filter((p) => p.sequences.length).length;
  console.log(`${out.length} programs, ${withSeq} with a sample sequence, ${out.length - withSeq} without${ONLY ? ' (--only: not written)' : ` -> ${OUT}`}`);
  if (ONLY) console.log(JSON.stringify(out, null, 1).slice(0, 6000));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
