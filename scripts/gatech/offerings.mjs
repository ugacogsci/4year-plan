/**
 * Which terms each Georgia Tech course has actually run in.
 *
 * Source: Georgia Tech's public Banner 9 class search (no login), the same
 * pages the "Browse Classes" screen calls:
 *   https://registration.banner.gatech.edu/StudentRegistrationSsb/ssb/classSearch/getTerms
 *   POST .../ssb/term/search?mode=search            (picks the term for this session)
 *   GET  .../ssb/searchResults/searchResults?txt_term=<code>&pageOffset=N&pageMaxSize=500
 *   POST .../ssb/classSearch/resetDataForm           (between terms)
 * The search with no subject returns every section of the term, 500 per page,
 * sorted by CRN so the paging is stable.
 *
 * Writes:
 *   public/gatech-offerings.json, the same shape as public/illinois-offerings.json:
 *     { school, source, fetchedAt,
 *       terms: [{ id: "fa2026", code: "202608", year, term, subjects, courses, sections, unreachable }],
 *       courses: { "CS 1301": ["sp2027", "fa2026", ...] },     newest first
 *       renumbered: { "CEE 4405": "CEE 3400" },   courses[now] holds the other number's terms (see below)
 *       elsewhere: { "CS 1301": { "su2025": ["Georgia Tech-Lorraine"] } },
 *       campuses: { counted: [...], seen: { campus: sections } } }
 *   data/gatech-raw/banner/<term code>/page-<offset>.json.gz, every page exactly
 *     as Banner sent it, plus terms.json and <term code>/done.json. A rerun
 *     re-reads a finished term from here and never asks Banner again; pass
 *     --refresh to crawl again, --parse-only to never touch the network.
 *
 * Run from the worktree root:
 *   node scripts/gatech/offerings.mjs [--terms 9] [--refresh] [--parse-only]
 *
 * The terms are the newest nine regular ones (fall, spring, summer) on the
 * term list, which today is Spring 2027 back to Summer 2024: three of each
 * season. Language Institute and other non-standard terms are skipped.
 *
 * Campus. `courses` counts sections on the Atlanta campus and its distance
 * and Atlanta graduate campuses (Video, Online, MBA Evening Program, Graduate
 * Certificate), the sections an Atlanta student registers for. A course that
 * ran in a term only at GT-Lorraine, on a study-abroad or exchange
 * placeholder, in the Peking University joint program or in the Freshman
 * Short Summer Session is NOT in `courses` for that term; it is listed in
 * `elsewhere` with the campus names, so nothing is lost.
 *
 * What it cannot know:
 *   - Whether a section listed in a past term actually met. Banner keeps
 *     cancelled sections out of the search, but a section with no students
 *     that was dropped after the term started may still be listed.
 *   - Whether the newest term (Spring 2027 today) is final. Departments still
 *     add sections before registration, so a course absent from it may yet run.
 *   - Renumbered courses, except where the catalog itself shows one (the
 *     `renumbered` pass below: same title, same description). Banner carries
 *     no "formerly" field, so any other renumbered course's old history sits
 *     under its old code.
 *   - Restricted sections. A course whose only section is reserved for a
 *     program (say, a cohort-only MBA section) still counts as offered.
 *
 * Politeness: one request at a time, at least 1.5 s apart, the planner's own
 * user agent, and a back-off of 15 s doubling to 4 min on 429, 202 or 5xx. A
 * redirect or an HTML page where JSON belongs (a login or bot wall) stops the
 * crawl at once; it is never worked around.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { UA, WAITS, sleep } from '../illinois/polite-get.mjs';

const ROOT = new URL('../../', import.meta.url);
const OUT = new URL('public/gatech-offerings.json', ROOT);
const RAW = new URL('data/gatech-raw/banner/', ROOT);
const HOST = 'https://registration.banner.gatech.edu';
const BASE = `${HOST}/StudentRegistrationSsb/ssb`;
const SOURCE = `${BASE}/classSearch/classSearch`;
const PAGE = 500;
const DELAY = 1500;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const TERM_COUNT = args.includes('--terms') ? Number(args[args.indexOf('--terms') + 1]) || 9 : 9;
const REFRESH = flag('--refresh');
const PARSE_ONLY = flag('--parse-only');

/**
 * The campuses an Atlanta student registers on. Banner's campus names, as seen
 * Summer 2024 to Spring 2027. "Video" carries many undergraduate distance
 * sections in summer (SPAN 1001, MGT 2250), so it counts. "Online" is the
 * online master's programs; "MBA Evening Program" and "Graduate Certificate"
 * are Atlanta graduate programs. They count too: they are graduate courses
 * an undergraduate plan rarely books, and they did run here.
 */
const COUNTED_CAMPUSES = new Set(['Georgia Tech-Atlanta', 'Video', 'Online', 'MBA Evening Program', 'Graduate Certificate']);
/**
 * Not counted, kept in `elsewhere`: study abroad and exchange placeholders,
 * GT-Lorraine in Metz, Shenzhen, Korea, Savannah, GTREP, the International
 * Logistics program ("Global"), the Peking University joint BME program, and the
 * Freshman Short Summer Session, which is restricted to entering first-years
 * (a course that ran in a summer only there is not a summer course for a
 * returning student).
 */
const ELSEWHERE_CAMPUSES = new Set(['GT Lorraine-Undergrad Programs', 'GT Lorraine-Graduate Programs', 'Georgia Tech Studies Abroad',
  'Foreign Exchange', 'GT, Peking University, & Emory', 'Freshman Short Summer Session',
  // Graduate sections taught away from Atlanta: Shenzhen and Korea, the
  // Savannah and Statesboro (GTREP) programs, and "Global", which is the
  // International Logistics executive master's.
  'Georgia Tech - Shenzhen', 'Georgia Tech - Korea', 'Georgia Tech-Savannah', 'Georgia Southern/GTREP', 'Global']);
const unknownCampuses = new Set();
/** Banner writes "Georgia Tech-Atlanta *" and "GT, Peking University, &amp; Emory". */
const campusName = (raw) => String(raw ?? '').replace(/&amp;/g, '&').replace(/\s*\*\s*$/, '').trim() || '(no campus)';
/** A campus Banner has never shown before is not counted, and is named in the run's output. */
const COUNTED = (campus) => {
  if (COUNTED_CAMPUSES.has(campus)) return true;
  if (!ELSEWHERE_CAMPUSES.has(campus)) unknownCampuses.add(campus);
  return false;
};

const SEASON = { '02': 'spring', '05': 'summer', '08': 'fall' };
const PREFIX = { spring: 'sp', summer: 'su', fall: 'fa' };

class Blocked extends Error {}

/* ---------------------------------------------------------------- network */

const jar = new Map();

/** resetDataForm answers a bare `true`, which is JSON too. */
function isJson(text) {
  try { JSON.parse(text); return true; } catch { return false; }
}
let lastRequest = 0;

function remember(res) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

/**
 * One request, paced and backed off. Returns the body text. A redirect or an
 * HTML page where JSON was asked for throws Blocked, which ends the crawl.
 */
async function request(url, { method = 'GET', body = null, json = true } = {}) {
  for (let a = 0; a <= WAITS.length; a += 1) {
    const wait = lastRequest + DELAY - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    let problem;
    try {
      const headers = { 'user-agent': UA, accept: json ? 'application/json, text/javascript, */*; q=0.01' : 'text/html,*/*' };
      if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      if (body) headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      if (json) headers['x-requested-with'] = 'XMLHttpRequest';
      const res = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(120_000) });
      remember(res);
      lastRequest = Date.now();
      if (res.status >= 300 && res.status < 400) {
        throw new Blocked(`${url} redirected (HTTP ${res.status}) to ${res.headers.get('location')}; not followed, it may be a login wall`);
      }
      const text = await res.text();
      if (res.status === 429 || res.status === 202 || res.status >= 500) problem = `busy (HTTP ${res.status})`;
      else if (!res.ok) problem = `HTTP ${res.status}`;
      else if (json && !isJson(text)) {
        if (/captcha|log ?in|sign ?in|sso\.gatech|cas\/login|access denied/i.test(text)) {
          throw new Blocked(`${url} answered with an HTML page that looks like a login or bot wall; stopped`);
        }
        problem = `not JSON (${text.length} bytes)`;
      } else return text;
    } catch (e) {
      if (e instanceof Blocked) throw e;
      problem = e.message;
    }
    if (a === WAITS.length) throw new Error(`${url}: gave up: ${problem}`);
    console.log(`  ${url}: ${problem}; waiting ${WAITS[a] / 1000}s`);
    await sleep(WAITS[a]);
  }
  throw new Error('unreachable');
}

async function startSession() {
  jar.clear();
  await request(`${BASE}/term/termSelection?mode=search`, { json: false });
}

async function chooseTerm(code) {
  await request(`${BASE}/classSearch/resetDataForm`, { method: 'POST', body: '' });
  const answer = await request(`${BASE}/term/search?mode=search`, {
    method: 'POST',
    body: new URLSearchParams({ term: code, studyPath: '', studyPathText: '', startDatepicker: '', endDatepicker: '' }).toString(),
  });
  const parsed = JSON.parse(answer);
  if (!parsed.fwdURL) throw new Error(`term ${code} was not accepted: ${answer.slice(0, 200)}`);
}

/* ------------------------------------------------------------------ cache */

const dirOf = (code) => new URL(`${code}/`, RAW);
const pageFile = (code, offset) => new URL(`page-${String(offset).padStart(5, '0')}.json.gz`, dirOf(code));
const doneFile = (code) => new URL('done.json', dirOf(code));

function readPages(code) {
  const dir = dirOf(code);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^page-\d+\.json\.gz$/.test(f))
    .sort()
    .map((f) => JSON.parse(gunzipSync(readFileSync(new URL(f, dir))).toString('utf8')));
}

/**
 * Crawl one term into the cache. Returns its done.json record.
 *
 * Older terms sometimes answer a page with {"success": true} and no rows
 * (seen on Spring 2025, Fall 2024 and Summer 2024, at different pages, while
 * the same page read fine from a new session a minute later). Such a page is
 * asked again twice in the same session, then the session is replaced and the
 * crawl carries on from that same page: pages are sorted by CRN, so a new
 * session's page N is the old session's page N. Up to four new sessions per term.
 */
async function crawlTerm(code) {
  rmSync(dirOf(code), { recursive: true, force: true }); // a term is only ever cached whole, with done.json written last
  mkdirSync(dirOf(code), { recursive: true });
  let total = null;
  let offset = 0;
  const crns = new Set();
  let sessions = 0;
  let problem = null;
  while (sessions < 5) {
    if (sessions > 0) {
      console.log(`  ${code}: ${problem}; new session, resuming at section ${offset}`);
      await sleep(WAITS[Math.min(sessions - 1, WAITS.length - 1)]);
    }
    sessions += 1;
    problem = null;
    await startSession();
    await chooseTerm(code);
    while (total === null || offset < total) {
      const url = `${BASE}/searchResults/searchResults?txt_term=${code}&startDatepicker=&endDatepicker=&pageOffset=${offset}&pageMaxSize=${PAGE}&sortColumn=courseReferenceNumber&sortDirection=asc`;
      let page = null;
      let text = '';
      for (let tries = 0; tries < 3 && !page; tries += 1) {
        text = await request(url);
        const parsed = JSON.parse(text);
        // An empty page is only an answer past the last section.
        if (parsed.success && Array.isArray(parsed.data) && (parsed.data.length > 0 || offset >= (parsed.totalCount ?? 0))) { page = parsed; break; }
        if (tries < 2) {
          console.log(`  ${code} page ${offset}: answered without rows (${text.slice(0, 100).replace(/\s+/g, ' ')}); asking again in ${WAITS[tries] / 1000}s`);
          await sleep(WAITS[tries]);
        }
      }
      if (!page) { problem = `page ${offset} came back without rows three times`; break; }
      if (page.data.some((s) => s.term !== code)) { problem = 'the session answered for another term'; break; }
      writeFileSync(pageFile(code, offset), gzipSync(text));
      total = Math.max(total ?? 0, page.totalCount ?? 0);
      for (const s of page.data) crns.add(s.courseReferenceNumber);
      process.stdout.write(`  ${code}: ${Math.min(offset + PAGE, total)}/${total}\r`);
      if (page.data.length === 0) break;
      offset += PAGE;
    }
    process.stdout.write('\n');
    if (problem) continue;
    const record = { code, totalCount: total ?? 0, distinctSections: crns.size, pages: Math.ceil((total ?? 0) / PAGE), sessions, fetchedAt: new Date().toISOString() };
    writeFileSync(doneFile(code), JSON.stringify(record, null, 1));
    return record;
  }
  throw new Error(`term ${code}: ${problem} (gave up after ${sessions} sessions; ${offset} of ${total ?? '?'} sections cached, not used)`);
}

/* ------------------------------------------------------------------- main */

mkdirSync(RAW, { recursive: true });
let termList;
if (PARSE_ONLY || (!REFRESH && existsSync(new URL('terms.json', RAW)))) {
  termList = JSON.parse(readFileSync(new URL('terms.json', RAW), 'utf8'));
}
if (!termList || (REFRESH && !PARSE_ONLY)) {
  const text = await request(`${BASE}/classSearch/getTerms?searchTerm=&offset=1&max=100`);
  writeFileSync(new URL('terms.json', RAW), text);
  termList = JSON.parse(text);
}

const wanted = termList
  .map((t) => {
    const m = String(t.code).match(/^(\d{4})(02|05|08)$/);
    const named = String(t.description).match(/^(Fall|Spring|Summer)\s+(\d{4})\b/i);
    if (!m || !named) return null;
    const term = SEASON[m[2]];
    if (named[1].toLowerCase() !== term || named[2] !== m[1]) return null;
    return { id: `${PREFIX[term]}${m[1]}`, code: t.code, year: Number(m[1]), term, description: t.description };
  })
  .filter(Boolean)
  .sort((a, b) => b.code.localeCompare(a.code))
  .slice(0, TERM_COUNT);
const skipped = termList.filter((t) => !wanted.some((w) => w.code === t.code) && Number(t.code) > Number(wanted.at(-1)?.code ?? 0));
console.log(`terms: ${wanted.map((w) => `${w.id} (${w.code})`).join(', ')}`);
if (skipped.length) console.log(`skipped as non-standard: ${skipped.map((t) => `${t.code} "${t.description}"`).join(', ')}`);

const failed = [];
let blocked = null;
for (const want of wanted) {
  const cached = existsSync(doneFile(want.code)) ? JSON.parse(readFileSync(doneFile(want.code), 'utf8')) : null;
  if (cached && !REFRESH) { console.log(`${want.id}: cached (${cached.totalCount} sections, ${cached.fetchedAt})`); continue; }
  if (PARSE_ONLY) { console.log(`${want.id}: not cached and --parse-only; skipped`); failed.push({ ...want, why: 'not cached' }); continue; }
  try {
    const r = await crawlTerm(want.code);
    console.log(`${want.id}: ${r.totalCount} sections listed, ${r.distinctSections} distinct read${r.distinctSections !== r.totalCount ? ' (MISMATCH)' : ''}`);
  } catch (e) {
    if (e instanceof Blocked) { blocked = e.message; console.error(`BLOCKED: ${e.message}`); break; }
    console.error(`${want.id}: failed: ${e.message}`);
    failed.push({ ...want, why: e.message });
  }
}

/* ------------------------------------------------------------------ parse */

const courses = {};
const elsewhere = {};
const seen = {};
const terms = [];
for (const want of wanted) {
  if (!existsSync(doneFile(want.code))) continue;
  const done = JSON.parse(readFileSync(doneFile(want.code), 'utf8'));
  const sections = new Map();
  for (const page of readPages(want.code)) for (const s of page.data ?? []) sections.set(s.courseReferenceNumber, s);
  const home = new Set();
  const away = new Map();
  const subjects = new Set();
  for (const s of sections.values()) {
    const campus = campusName(s.campusDescription);
    seen[campus] = (seen[campus] ?? 0) + 1;
    const code = `${String(s.subject).trim()} ${String(s.courseNumber).trim()}`;
    if (COUNTED(campus)) { home.add(code); subjects.add(String(s.subject).trim()); } else {
      if (!away.has(code)) away.set(code, new Set());
      away.get(code).add(campus);
    }
  }
  for (const code of home) (courses[code] ??= []).push(want.id);
  for (const [code, campuses] of away) {
    if (home.has(code)) continue;
    (elsewhere[code] ??= {})[want.id] = [...campuses].sort();
  }
  const missing = done.totalCount - sections.size;
  terms.push({
    id: want.id, code: want.code, year: want.year, term: want.term,
    subjects: subjects.size, courses: home.size, sections: sections.size,
    unreachable: missing > 0 ? missing : 0,
    ...(missing > 0 ? { note: `${missing} of ${done.totalCount} sections Banner counted were not read` } : {}),
  });
  console.log(`${want.id}: ${sections.size} sections, ${home.size} courses in ${subjects.size} subjects on the counted campuses, ${[...away.keys()].filter((c) => !home.has(c)).length} courses only elsewhere${missing > 0 ? `, ${missing} sections unread` : ''}`);
}

/**
 * Renumbered courses. Banner carries no "formerly" field, but the catalog
 * does carry, for a handful of courses with no section in nine terms, a
 * second course of the same title AND the same description that has run:
 * CEE 4405 and CEE 3400 (Introduction to Geotechnical Engineering), ISYE
 * 2028 and ISYE 3030 (Basic Statistical Methods), MATH 2740 and CS 2740
 * (Foundations of Mathematics and Computing), CHEM 4512 and CHEM 3522. One
 * course under two numbers; a board that books the one with no history was
 * told it "has not run" (CEE 4405 on Geosystems, MATH 2740 on three
 * Mathematics with Computing boards, 2026-11-09).
 *
 * The two histories are joined the way scripts/illinois/build-index.mjs
 * joins Illinois's renumbered language courses: courses[now] is the union
 * of its own terms (none) and the other number's, and renumbered[now] names
 * the number it ran under, so a reader can always tell borrowed history from
 * Banner's own. Only an exact match counts: the same title and description,
 * exactly one such course, neither of them research or internship, and not
 * two numbers of one subject less than ten apart (VIP 2601 and 2602, GT 2201
 * and 2202 are the steps of a sequence, not one course). A course whose
 * description changed with its number (ID 2022 and ID 2024, both "Industrial
 * Design Studio 2") is a revision, not a renumbering, and is left alone.
 * Needs public/gatech-catalog.json (scripts/gatech/courses.mjs); without it
 * nothing is joined.
 */
const renumbered = {};
{
  const catalogFile = new URL('public/gatech-catalog.json', ROOT);
  if (existsSync(catalogFile)) {
    const NOISE_TITLE = /\b(independent study|thesis research|special problems|individual|undergraduate research|internship|co-?op\b|work experience|recitation|assistantship|special topics)\b/i;
    const T = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const rows = JSON.parse(readFileSync(catalogFile, 'utf8')).courses.filter((c) => Number.parseInt(c.number, 10) < 5000 && !NOISE_TITLE.test(c.title));
    const byKey = new Map();
    for (const c of rows) {
      const k = `${T(c.title)}|${T(c.description)}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(c);
    }
    for (const c of rows) {
      if (courses[c.code]?.length) continue;
      const twins = (byKey.get(`${T(c.title)}|${T(c.description)}`) ?? []).filter((x) => x.code !== c.code && courses[x.code]?.length && !(x.subject === c.subject && Math.abs(Number.parseInt(x.number, 10) - Number.parseInt(c.number, 10)) < 10));
      if (twins.length !== 1) continue;
      renumbered[c.code] = twins[0].code;
      courses[c.code] = [...courses[twins[0].code]];
    }
  }
}

const order = terms.map((t) => t.id);
for (const code of Object.keys(courses)) courses[code].sort((a, b) => order.indexOf(a) - order.indexOf(b));
const sortedCourses = Object.fromEntries(Object.entries(courses).sort(([a], [b]) => a.localeCompare(b)));
const sortedElsewhere = Object.fromEntries(Object.entries(elsewhere).sort(([a], [b]) => a.localeCompare(b)));
const counted = Object.keys(seen).filter((c) => COUNTED_CAMPUSES.has(c)).sort();
const fetchedAt = terms.length
  ? wanted.filter((w) => existsSync(doneFile(w.code))).map((w) => JSON.parse(readFileSync(doneFile(w.code), 'utf8')).fetchedAt).sort().at(-1)
  : new Date().toISOString();

if (terms.length === 0) {
  console.error('No term was read. Nothing written.');
  process.exit(1);
}
mkdirSync(new URL('public/', ROOT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  school: 'gatech',
  source: SOURCE,
  fetchedAt,
  terms,
  courses: sortedCourses,
  renumbered: Object.fromEntries(Object.entries(renumbered).sort(([a], [b]) => a.localeCompare(b))),
  elsewhere: sortedElsewhere,
  campuses: { counted, seen: Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1])) },
}));
console.log(`\n${Object.keys(sortedCourses).length} courses seen on the counted campuses across ${terms.length} terms; ${Object.keys(sortedElsewhere).length} courses with a term only elsewhere`);
console.log(`renumbered (same title and description, history joined): ${Object.entries(renumbered).map(([a, b]) => `${a} ran as ${b}`).join(', ') || 'none'}`);
console.log(`campuses seen: ${Object.entries(seen).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join('; ')}`);
if (unknownCampuses.size) console.log(`NEW campus names, not counted until COUNTED_CAMPUSES or ELSEWHERE_CAMPUSES names them: ${[...unknownCampuses].join('; ')}`);
if (failed.length) console.log(`FAILED terms: ${failed.map((f) => `${f.id}: ${f.why}`).join('; ')}`);
if (blocked) { console.log(`BLOCKED: ${blocked}`); process.exit(3); }
