#!/usr/bin/env node
/**
 * Builds public/uga/course-offerings.json from UGA's Schedule of Classes:
 * per course per term, how many sections ran, how full they were, on which
 * campus, and who taught them. The reading rules (codes, versions, labs,
 * what each number means) are in lib/planner/uga-offerings.ts, which the
 * planner and ARCH read the file with.
 *
 * Source: the Registrar's Schedule of Classes,
 * https://reg.uga.edu/registration/schedule-of-classes/, which publishes one
 * CSV per term (one row per meeting time; a section with two meeting times is
 * two rows of one CRN):
 *   - the three terms it shows now (a fall, a spring and a summer slot that
 *     roll forward on their own, refreshed each morning at 7:55), read
 *     through the page's own download relay,
 *     https://reg.uga.edu/wp-admin/admin-ajax.php?action=soc_csv&term=<slot>,
 *     which leaves out any course the Registrar hides from the public
 *     schedule (the raw files behind it, https://apps.reg.uga.edu/soc/<slot>.csv,
 *     do not);
 *   - the frozen final files of past terms, in FINALS below. The Registrar
 *     posts one when a term closes; add it here. A term read before and not
 *     read this run (its slot rolled forward, no final posted yet) is kept as
 *     it was in the previous file. The newest five terms are kept.
 * The file is about 2.5 MB for five terms.
 * Fall 2025 and older terms are archived only as attachment pages under
 * /archives/soc/, which reg.uga.edu/robots.txt closes to crawlers, so they
 * are not read.
 *
 * Politeness: reg.uga.edu/robots.txt allows /wp-admin/admin-ajax.php and
 * /wp-content/uploads/ and asks for 10 seconds between requests; it is read
 * again on every run, and the run stops if it no longer allows a file. The
 * schedule page itself (/registration/schedule-of-classes/) is closed to
 * crawlers and is never fetched. One file at a time, the house user agent,
 * robots.txt and at most five files a run: a current slot is read again only
 * when the copy on disk is from an earlier day, a final file only once.
 * Anything that is not the schedule's CSV (an error page, a challenge) stops
 * the run.
 *
 * The downloads stay out of git (default .tmp/uga-schedule/, which is
 * ignored); only the facts in public/uga/course-offerings.json are kept.
 *
 *   node scripts/uga/schedule-build.mjs                  (download what is missing or stale, then build)
 *   node scripts/uga/schedule-build.mjs --cache <dir>    (keep the downloads in <dir>)
 *   node scripts/uga/schedule-build.mjs --offline        (build from the downloads already on disk)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

const ROOT = join(HERE, '..', '..');
const C = await import(join(ROOT, 'lib', 'planner', 'uga-course-codes.ts'));
const O = await import(join(ROOT, 'lib', 'planner', 'uga-offerings.ts'));

const UA = 'FourYearPlanBot/1.0 (student planning project; respects robots.txt)';
const HOST = 'https://reg.uga.edu';
const PAGE = `${HOST}/registration/schedule-of-classes/`;
const RELAY = `${HOST}/wp-admin/admin-ajax.php?action=soc_csv&term=`;
const SLOTS = ['fall', 'spring', 'summer'];
const FINALS = [
  `${HOST}/wp-content/uploads/soc_2026_spring_final.csv`,
  `${HOST}/wp-content/uploads/soc_summer2026_FINAL.csv`,
];
const OUT = join(ROOT, 'public', 'uga', 'course-offerings.json');
const CATALOG = join(ROOT, 'public', 'uga-catalog.json');
/** At least robots.txt's Crawl-delay; never under this. */
const MIN_GAP_MS = 10_000;
/** The schedule prints 999 for a section with no set enrollment limit. */
const NO_LIMIT = 999;
/** The newest terms kept: five is a year of falls, springs and summers either side of now. */
const MAX_TERMS = 5;
const GRADUATE = / [6-9]\d{3}/;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const CACHE = resolve(option('--cache') ?? join(ROOT, '.tmp', 'uga-schedule'));
const OFFLINE = flag('--offline');
// The Registrar's day (it refreshes at 7:55 in Athens), as YYYY-MM-DD.
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stop = (msg) => {
  console.error(msg);
  process.exit(1);
};

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

/** robots.txt's rules for our agent (its own group, else "*"): allow/disallow prefixes and the delay. */
function robotsRules(text) {
  const groups = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, field, value] = m;
    if (/^user-agent$/i.test(field)) {
      if (!current || current.rules.length || current.delay !== null) groups.push((current = { agents: [], rules: [], delay: null }));
      current.agents.push(value.toLowerCase());
    } else if (current && /^(allow|disallow)$/i.test(field)) {
      if (value) current.rules.push({ allow: /^allow$/i.test(field), path: value });
    } else if (current && /^crawl-delay$/i.test(field)) current.delay = Number(value) || null;
  }
  const ours = groups.find((g) => g.agents.some((a) => a !== '*' && UA.toLowerCase().startsWith(a)));
  return ours ?? groups.find((g) => g.agents.includes('*')) ?? { agents: [], rules: [], delay: null };
}

/** The longest matching rule decides; Allow wins a tie. */
function robotsAllow(rules, path) {
  let best = null;
  for (const r of rules.rules) {
    if (!path.startsWith(r.path.replace(/\*$/, ''))) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

let lastRequest = 0;
let gap = MIN_GAP_MS;
async function politeFetch(url) {
  const wait = lastRequest + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  return fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(180_000) });
}

const HEADER = /^\uFEFF?"ACADEMIC_PERIOD","SCHEDULE_OFFERING\.SUBJECT",/;

/** One term's CSV, from the cache when it is fresh enough, else downloaded. */
async function termFile(source, rules) {
  const file = join(CACHE, source.file);
  const sidecar = `${file}.json`;
  const saved = existsSync(file) && existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, 'utf8')) : null;
  const fresh = saved && (source.final || saved.fetchedAt === today());
  if (fresh || (OFFLINE && saved)) return { text: readFileSync(file, 'utf8'), fetchedAt: saved.fetchedAt };
  if (OFFLINE) stop(`--offline: ${file} is not on disk; run once without --offline.`);
  const { pathname, search } = new URL(source.url);
  const path = pathname + search;
  if (!robotsAllow(rules, path)) stop(`reg.uga.edu/robots.txt no longer allows ${path}; nothing downloaded. Look before changing anything here.`);
  console.log(`  downloading ${source.url}`);
  const res = await politeFetch(source.fetchUrl ?? source.url);
  const text = await res.text();
  if (!res.ok || !HEADER.test(text)) stop(`${source.url}: HTTP ${res.status}, ${text.length} bytes, not the Schedule of Classes CSV (starts ${JSON.stringify(text.slice(0, 80))}). Stopped; nothing is worked around.`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
  const fetchedAt = today();
  writeFileSync(sidecar, JSON.stringify({ url: source.url, fetchedAt, bytes: Buffer.byteLength(text) }));
  return { text, fetchedAt };
}

// ---------------------------------------------------------------------------
// Reading a term
// ---------------------------------------------------------------------------

/** RFC 4180 rows: quoted fields may hold commas, doubled quotes and line breaks. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

const SEASON_OF_MONTH = { '02': 'Spring', '05': 'Summer', '08': 'Fall' };
/** "8/17/2026" -> "2026-08-17". */
const isoDate = (s) => {
  const m = String(s ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
};
const bump = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const sortedCounts = (map) => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

/** "First Last"; a name the schedule wrote all in capitals ("JASON SCHMIDT") in ordinary case. */
function personName(first, last) {
  const name = [first, last].map((s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
  if (!/\p{Lu}/u.test(name) || name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase());
}

/** Every way the schedule writes each person, so one form is shown everywhere. */
const written = new Map();
const nameKey = (name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '') || name.toLowerCase();
function noteName(name) {
  const key = nameKey(name);
  if (!written.has(key)) written.set(key, new Map());
  bump(written.get(key), name);
  return key;
}
/** The form shown: with its accents when a section has them ("Žaklina Grgić", not "Zaklina Grgic"), else the commonest. */
function shownName(key) {
  const forms = [...written.get(key)];
  const accented = forms.filter(([n]) => /[^\x00-\x7f]/.test(n));
  return sortedCounts(new Map(accented.length ? accented : forms))[0][0];
}
const named = (counts) => sortedCounts(new Map([...counts].map(([key, n]) => [shownName(key), n])));

/** One term's sections, deduplicated by CRN, active ones only, read into per-course entries. */
function readTerm(text, source, fetchedAt, known) {
  const [head, ...rows] = parseCsv(text);
  const col = Object.fromEntries(head.map((h, i) => [h.replace(/^SCHEDULE_OFFERING\./, ''), i]));
  for (const need of ['ACADEMIC_PERIOD', 'SUBJECT', 'COURSE_NUMBER', 'STATUS', 'CAMPUS', 'CAMPUS_DESC', 'MAXIMUM_ENROLLMENT', 'ACTUAL_ENROLLMENT', 'PRIMARY_INSTRUCTOR_FIRST_NAME', 'PRIMARY_INSTRUCTOR_LAST_NAME', 'COURSE_REFERENCE_NUMBER', 'SCHEDULE_DESC', 'ACADEMIC_PERIOD_DESC', 'STVPTRM.STVPTRM_DESC', 'MEETING_TIME.START_DATE', 'MEETING_TIME.END_DATE']) {
    if (col[need] === undefined) stop(`${source.url}: no ${need} column; the Registrar changed the file, so the reading rules here need a look.`);
  }
  const get = (r, k) => r[col[k]] ?? '';
  const period = get(rows[0], 'ACADEMIC_PERIOD');
  const label = get(rows[0], 'ACADEMIC_PERIOD_DESC');
  if (!/^\d{4}(02|05|08)$/.test(period) || label !== `${SEASON_OF_MONTH[period.slice(4)]} ${period.slice(0, 4)}`) stop(`${source.url}: term ${period} "${label}" is not one this script knows how to read.`);

  const seen = new Set();
  const statuses = new Map();
  const campuses = new Map();
  const people = new Set();
  const courses = new Map();
  let start = null;
  let end = null;
  let sections = 0;
  let enrolled = 0;
  let notInCatalog = 0;
  for (const r of rows) {
    if (get(r, 'ACADEMIC_PERIOD') !== period) stop(`${source.url}: rows from more than one term (${period}, ${get(r, 'ACADEMIC_PERIOD')}).`);
    if (get(r, 'STVPTRM.STVPTRM_DESC') === 'Full Term') {
      const s = isoDate(get(r, 'MEETING_TIME.START_DATE'));
      const e = isoDate(get(r, 'MEETING_TIME.END_DATE'));
      if (s && (!start || s < start)) start = s;
      if (e && (!end || e > end)) end = e;
    }
    const crn = get(r, 'COURSE_REFERENCE_NUMBER');
    if (seen.has(crn)) continue; // the section's next meeting time
    seen.add(crn);
    bump(statuses, get(r, 'STATUS'));
    if (get(r, 'STATUS') !== 'A') continue; // cancelled ("X", "C") or pending ("P")
    const code = C.normUgaCode(`${get(r, 'SUBJECT')} ${get(r, 'COURSE_NUMBER')}`);
    const k = O.offeringKeyOf(code, known);
    const entry = courses.get(k.key) ?? { sections: 0, enrolled: 0, seats: 0, noLimit: 0, campuses: new Map(), instructors: new Map(), unnamed: 0, versions: new Map(), parts: new Map(), starred: true };
    courses.set(k.key, entry);
    if (k.part) { bump(entry.parts, k.part); continue; }
    if (!known(k.key)) notInCatalog += 1;
    sections += 1;
    const actual = Number(get(r, 'ACTUAL_ENROLLMENT')) || 0;
    const limit = Number(get(r, 'MAXIMUM_ENROLLMENT')) || 0;
    enrolled += actual;
    entry.sections += 1;
    entry.enrolled += actual;
    if (limit >= NO_LIMIT) entry.noLimit += 1;
    else entry.seats += limit;
    const campus = get(r, 'CAMPUS');
    bump(entry.campuses, campus);
    if (!campuses.has(campus)) campuses.set(campus, get(r, 'CAMPUS_DESC'));
    // The schedule stars its one-to-one types: "Directed Study*", "Doctoral Research*".
    if (!/\*$/.test(get(r, 'SCHEDULE_DESC'))) entry.starred = false;
    const person = personName(get(r, 'PRIMARY_INSTRUCTOR_FIRST_NAME'), get(r, 'PRIMARY_INSTRUCTOR_LAST_NAME'));
    const name = person && noteName(person);
    if (name) { bump(entry.instructors, name); people.add(name); }
    else entry.unnamed += 1;
    if (k.version) {
      const v = entry.versions.get(k.version) ?? { sections: 0, instructors: new Map() };
      entry.versions.set(k.version, v);
      v.sections += 1;
      if (name) bump(v.instructors, name);
    }
  }
  if (sections === 0) stop(`${source.url}: no active sections; not the whole schedule.`);
  const status = source.final || (end && end < fetchedAt) ? 'final' : start && start <= fetchedAt ? 'in session' : 'upcoming';
  return {
    term: { label, period, status, url: source.url, fetchedAt, enrolled, courses: [...courses.values()].filter((e) => e.sections > 0).length, sections, instructors: people.size },
    courses,
    campuses,
    stats: { rows: rows.length, crns: seen.size, statuses: Object.fromEntries(statuses), notInCatalog },
  };
}

/**
 * A term's entry for one course, in the file's shape, empty fields left out
 * to keep the file small: campuses only when a section is off the Athens
 * campus, and for a graduate course taken one to one with a supervisor
 * (thesis, dissertation, research hours: a section for every professor who
 * supervises) how many supervise rather than the names, which were a fifth
 * of the file and are no help to planning.
 */
function shipped(code, entry, registrationOpen) {
  const out = { sections: entry.sections };
  if (registrationOpen) out.enrolled = entry.enrolled;
  out.seats = entry.seats;
  if (entry.noLimit) out.noLimit = entry.noLimit;
  if (entry.campuses.size !== 1 || !entry.campuses.has(O.MAIN_CAMPUS)) out.campuses = Object.fromEntries(sortedCounts(entry.campuses));
  const individual = entry.starred && entry.sections > 0;
  if (individual && GRADUATE.test(code)) out.supervisors = entry.instructors.size;
  else out.instructors = named(entry.instructors);
  if (entry.unnamed) out.unnamed = entry.unnamed;
  if (entry.versions.size) {
    out.versions = Object.fromEntries([...entry.versions].sort().map(([v, x]) => [v, x.instructors.size ? { sections: x.sections, instructors: named(x.instructors) } : { sections: x.sections }]));
  }
  if (entry.parts.size) out.parts = Object.fromEntries([...entry.parts].sort());
  if (individual) out.individual = true;
  return out;
}

/**
 * Subjects an upcoming term has posted under 60% of last year's sections
 * for (the same season's newest term that is final or in session, where the
 * subject had ten or more): departments add sections until classes begin,
 * so a course of theirs missing now is not yet "not offered".
 */
function stillPosting(term, terms, courses) {
  const before = terms.find((t) => t.label.split(' ')[0] === term.label.split(' ')[0] && t.status !== 'upcoming' && t.period < term.period);
  if (!before) return [];
  const count = (label) => {
    const out = new Map();
    for (const [code, byTerm] of Object.entries(courses)) if (byTerm[label]) bump(out, code.split(' ')[0], byTerm[label].sections);
    return out;
  };
  const was = count(before.label);
  const now = count(term.label);
  return [...was].filter(([subject, n]) => n >= 10 && (now.get(subject) ?? 0) < n * 0.6).map(([subject]) => subject).sort();
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
// The planner books each code a catalog row lists (components/planner/uga-source.tsx).
const catalogCodes = new Set(catalog.flatMap((row) => C.listedUgaCourseCodes(row.code)));
const known = (code) => catalogCodes.has(code);

const sources = [
  ...SLOTS.map((slot) => ({ url: `${RELAY}${slot}`, fetchUrl: `${RELAY}${slot}&d=${today().replace(/-/g, '')}`, file: `${slot}.csv`, final: false })),
  ...FINALS.map((url) => ({ url, file: basename(url), final: true })),
];

let rules = { rules: [], delay: null };
if (!OFFLINE) {
  console.log(`reading ${HOST}/robots.txt`);
  const res = await politeFetch(`${HOST}/robots.txt`);
  if (!res.ok) stop(`robots.txt: HTTP ${res.status}; stopped.`);
  rules = robotsRules(await res.text());
  gap = Math.max(MIN_GAP_MS, (rules.delay ?? 0) * 1000);
}

const read = new Map();
const campusNames = new Map();
for (const source of sources) {
  const { text, fetchedAt } = await termFile(source, rules);
  const term = readTerm(text, source, fetchedAt, known);
  const had = read.get(term.term.period);
  // A term both in a slot and in a final file: the final file is the record.
  if (had && (had.term.status === 'final' || !source.final)) continue;
  read.set(term.term.period, term);
  for (const [code, name] of term.campuses) campusNames.set(code, name);
  const s = term.stats;
  const left = Object.entries(s.statuses).filter(([status]) => status !== 'A').map(([status, n]) => `${n} ${status}`).join(', ');
  console.log(`  ${term.term.label} (${term.term.status}): ${s.rows} rows, ${s.crns} sections (${left} not active), ${term.term.sections} active in ${term.term.courses} courses, ${term.term.instructors} instructors, ${term.term.enrolled} enrolled; ${s.notInCatalog} active sections (${((s.notInCatalog / term.term.sections) * 100).toFixed(1)}%) under codes the catalog does not list`);
}

const courses = {};
const terms = [...read.values()].map((t) => t.term);
for (const t of read.values()) {
  const open = t.term.enrolled > 0;
  for (const [code, entry] of t.courses) (courses[code] ??= {})[t.term.label] = shipped(code, entry, open);
}

// Terms read before and not this run stay as they were.
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
for (const t of prev?.terms ?? []) {
  if (read.has(t.period)) continue;
  console.log(`  ${t.label}: not read this run; kept from the previous file (read ${t.fetchedAt})`);
  terms.push(t);
  for (const [code, byTerm] of Object.entries(prev.courses)) if (byTerm[t.label]) (courses[code] ??= {})[t.label] = byTerm[t.label];
  for (const [code, name] of Object.entries(prev.campuses ?? {})) if (!campusNames.has(code)) campusNames.set(code, name);
}
terms.sort((a, b) => b.period.localeCompare(a.period));
for (const t of terms.splice(MAX_TERMS)) {
  console.log(`  ${t.label}: older than the newest ${MAX_TERMS} terms; left out`);
  for (const byTerm of Object.values(courses)) delete byTerm[t.label];
}
for (const t of terms) {
  delete t.stillPosting;
  const subjects = t.status === 'upcoming' ? stillPosting(t, terms, courses) : [];
  if (subjects.length) {
    t.stillPosting = subjects;
    console.log(`  ${t.label}: still being posted in ${subjects.join(', ')}`);
  }
}
const order = terms.map((t) => t.label);

const codes = Object.keys(courses).filter((c) => Object.keys(courses[c]).length > 0).sort();
const file = {
  school: 'uga',
  source: 'UGA Office of the Registrar, Schedule of Classes',
  page: PAGE,
  collectedAt: terms.map((t) => t.fetchedAt).sort().at(-1),
  terms,
  campuses: Object.fromEntries([...campusNames].sort()),
  notInCatalog: codes.filter((c) => !known(c)),
  courses: Object.fromEntries(codes.map((c) => [c, Object.fromEntries(order.filter((l) => courses[c][l]).map((l) => [l, courses[c][l]]))])),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(file));

const sectionsOf = (pick) => Object.entries(file.courses).reduce((n, [c, byTerm]) => n + (pick(c) ? Object.values(byTerm).reduce((m, o) => m + o.sections, 0) : 0), 0);
const all = sectionsOf(() => true);
const missed = sectionsOf((c) => !known(c));
const counted = new Map(file.notInCatalog.map((c) => [c, Object.values(file.courses[c]).reduce((m, o) => m + o.sections, 0)]));
console.log(`wrote ${OUT}: ${(statSync(OUT).size / 1048576).toFixed(2)} MiB, ${terms.length} terms, ${codes.length} courses (${file.notInCatalog.length} not in the catalog)`);
console.log(`  ${all} active sections, ${missed} (${((missed / all) * 100).toFixed(1)}%) under codes the catalog does not list, most: ${sortedCounts(counted).slice(0, 12).map(([c, n]) => `${c} ${n}`).join(', ')}`);
