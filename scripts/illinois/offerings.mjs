/**
 * Which terms each course has actually run in.
 *
 * Illinois publishes no "offered in" line anywhere in its catalog, so the
 * planner had to assume every course runs every fall and spring. It does not:
 * FIN 442 has not appeared in the Course Explorer for at least four terms, and
 * a plan that books it is booking a course the student cannot register for.
 *
 * The Course Explorer's subject page for a term lists only the courses with
 * sections that term (Summer 2025 shows 11 FIN courses against 66 in a fall),
 * so one request per subject per term is enough. Eight terms back, about
 * 1,400 requests, one every 700 ms, same user agent as schedule.mjs.
 *
 * Output: public/illinois-offerings.json
 *   { terms: [{ id: "fa2026", year, term, subjects }], courses: { "FIN 423": ["fa2026", "sp2026", ...] } }
 * Written after every term, so a rerun resumes.
 *
 * Gaps. The first Fall 2026 read lost its last 45 subjects (NPRE through
 * WRIT) to the site's busy replies and still recorded the term as done, so
 * 982 courses that run this fall, PSYC 338 and REL 101 among them, read as
 * "has not run recently". A recorded term is now read again where it has a
 * hole, and only there:
 *   - subjects whose page could not be read last time (unreadSubjects);
 *   - subjects the class-times crawl for that term found courses in, with no
 *     course on this record (that is how the Fall 2026 hole is found);
 *   - subjects named with --reread <term id>=SUBJ,SUBJ (for example
 *     --reread su2026=RUSS,SPAN), for a hole only a person can see.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { politeGet, sleep } from './polite-get.mjs';

const BASE = process.env.ILLINOIS_SCHEDULE_BASE ?? 'https://courses.illinois.edu/schedule';
const OUT = 'public/illinois-offerings.json';
const DELAY = 700;

/**
 * The Course Explorer answers a burst of requests with 202 and an empty
 * body, which is a polite "not now" rather than a page. Treated as a page it
 * read as "no courses this term" and emptied a whole season. politeGet backs
 * off on such a reply, doubling from fifteen seconds, and the crawl paces
 * itself at 700 ms between requests to stay under the limit in the first
 * place. A subject still unread is named on its term, and the next run reads
 * it again.
 */
const get = (url) => politeGet(url);

const ID_OF_SEASON = { fall: 'fa', spring: 'sp', summer: 'su' };

/** The terms to read, newest first: this fall and the seven before it. */
function termsWanted() {
  const now = new Date();
  const year = now.getFullYear();
  const order = ['fall', 'summer', 'spring'];
  const out = [];
  let y = year;
  let i = 0; // fall of this year first
  while (out.length < 8) {
    out.push({ id: `${{ fall: 'fa', summer: 'su', spring: 'sp' }[order[i]]}${y}`, year: y, term: order[i] });
    i += 1;
    if (i === order.length) { i = 0; y -= 1; }
  }
  return out;
}

/**
 * The class-times crawls on disk, by term id. public/illinois-sections.json
 * is Fall 2026 (the first crawl, from before terms had files of their own)
 * and public/illinois-sections-<id>.json is every later one. Each knows which
 * subjects really had courses that term.
 */
function classTimeCrawls() {
  const out = new Map();
  if (!existsSync('public')) return out;
  for (const name of readdirSync('public').filter((f) => /^illinois-sections(-(fa|sp|su)\d{4})?\.json$/.test(f))) {
    try {
      const file = JSON.parse(readFileSync(`public/${name}`, 'utf8'));
      const id = `${ID_OF_SEASON[file.term]}${file.year}`;
      // A term's own file wins over the first crawl's shared name.
      if (!out.has(id) || name !== 'illinois-sections.json') out.set(id, { name, file });
    } catch (e) {
      console.log(`  public/${name}: unreadable (${e.message}); not used`);
    }
  }
  return out;
}

/** Subjects a class-times crawl saw courses in. */
function subjectsWithCourses(file) {
  const out = new Set((file.courses ?? []).map((c) => c.subject));
  for (const [subj, nums] of Object.entries(file.listed ?? {})) if (nums.length) out.add(subj);
  return out;
}

/** --reread su2026=RUSS,SPAN, repeatable. */
function rereadRequests() {
  const out = new Map();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== '--reread') continue;
    const m = String(args[i + 1] ?? '').match(/^((?:fa|sp|su)\d{4})=([A-Z,]+)$/);
    if (!m) { console.error(`--reread takes <term id>=SUBJ,SUBJ, for example su2026=RUSS,SPAN, not "${args[i + 1]}"`); process.exit(2); }
    out.set(m[1], [...new Set([...(out.get(m[1]) ?? []), ...m[2].split(',').filter(Boolean)])]);
  }
  return out;
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const done = new Map((prev?.terms ?? []).filter((t) => !t.missing && (t.courses ?? 0) > 0).map((t) => [t.id, t]));
const courses = prev?.courses ?? {};
const terms = [];
const knownSubjects = new Set(Object.keys(courses).map((code) => code.split(' ')[0]));
const crawls = classTimeCrawls();
const rereads = rereadRequests();

const save = () => {
  mkdirSync('public', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ school: 'illinois', source: BASE, fetchedAt: new Date().toISOString(), terms: [...terms, ...[...done.values()].filter((t) => !terms.includes(t))], courses }));
};

/** Read these subject pages for one term into `courses`. Returns how many listings were new and which pages stayed unread. */
async function readSubjects(want, subjects) {
  let added = 0;
  let listings = 0;
  const unread = [];
  for (const subj of subjects) {
    const page = await get(`${BASE}/${want.year}/${want.term}/${subj}`);
    await sleep(DELAY);
    if (!page) { unread.push(subj); continue; }
    const nums = [...new Set([...page.matchAll(new RegExp(`href="/schedule/${want.year}/${want.term}/${subj}/(\\d{3})"`, 'g'))].map((m) => m[1]))];
    for (const num of nums) {
      const code = `${subj} ${num}`;
      const have = courses[code] ?? (courses[code] = []);
      if (!have.includes(want.id)) { have.push(want.id); added += 1; }
      listings += 1;
    }
  }
  return { added, listings, unread };
}

const countOn = (id) => Object.values(courses).filter((ids) => ids.includes(id)).length;

for (const want of termsWanted()) {
  if (done.has(want.id)) {
    const record = done.get(want.id);
    const recorded = new Set(Object.entries(courses).filter(([, ids]) => ids.includes(want.id)).map(([code]) => code.split(' ')[0]));
    const crawl = crawls.get(want.id);
    const holes = crawl ? [...subjectsWithCourses(crawl.file)].filter((s) => !recorded.has(s)).sort() : [];
    const again = [...new Set([...(record.unreadSubjects ?? []), ...holes, ...(rereads.get(want.id) ?? [])])];
    if (again.length === 0) {
      terms.push(record);
      console.log(`${want.id}: already read (${record.subjects} subjects)`);
      continue;
    }
    console.log(`${want.id}: recorded, but ${again.length} subjects have no course on the record${holes.length ? ` (${holes.length} of them have courses in ${crawl.name})` : ''}; reading them again: ${again.join(' ')}`);
    const r = await readSubjects(want, again);
    record.courses = countOn(want.id);
    record.unreachable = r.unread.length;
    if (r.unread.length) record.unreadSubjects = r.unread; else delete record.unreadSubjects;
    terms.push(record);
    console.log(`${want.id}: ${r.added} course listings added from ${again.length - r.unread.length} subjects, now ${record.courses}${r.unread.length ? `; still unread: ${r.unread.join(' ')}` : ''}`);
    save();
    continue;
  }
  const index = await get(`${BASE}/${want.year}/${want.term}`);
  await sleep(DELAY);
  let subjects = index ? [...new Set([...index.matchAll(new RegExp(`href="/schedule/${want.year}/${want.term}/([A-Z]{2,4})/?"`, 'g'))].map((m) => m[1]))] : [];
  // A past term's index page carries no subject list, but its subject pages
  // still answer, so the live term's list stands in for it. Subjects come and
  // go rarely enough that a missing one is a course or two, not a season.
  if (subjects.length < 50 && knownSubjects.size >= 50) {
    subjects = [...knownSubjects];
    console.log(`${want.id}: no subject list on the index page; using the ${subjects.length} subjects known from the live term`);
  }
  if (subjects.length < 50) { console.log(`${want.id}: no subject list (${subjects.length}); skipped`); terms.push({ id: want.id, year: want.year, term: want.term, subjects: 0, missing: true }); continue; }
  for (const subj of subjects) knownSubjects.add(subj);
  const r = await readSubjects(want, subjects);
  if (r.listings === 0) { console.log(`${want.id}: nothing read (${r.unread.length} subject pages unreachable); not recorded`); continue; }
  terms.push({ id: want.id, year: want.year, term: want.term, subjects: subjects.length, courses: r.listings, unreachable: r.unread.length, ...(r.unread.length ? { unreadSubjects: r.unread } : {}) });
  console.log(`${want.id}: ${subjects.length} subjects, ${r.listings} course listings${r.unread.length ? `, ${r.unread.length} subject pages unreachable` : ''}`);
  save();
}
const order = terms.map((t) => t.id);
for (const code of Object.keys(courses)) courses[code].sort((a, b) => order.indexOf(a) - order.indexOf(b));
writeFileSync(OUT, JSON.stringify({ school: 'illinois', source: BASE, fetchedAt: new Date().toISOString(), terms, courses }));
console.log(`\n${Object.keys(courses).length} courses seen across ${terms.filter((t) => !t.missing).length} terms`);
