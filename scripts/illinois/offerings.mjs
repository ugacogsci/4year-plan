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
 * 1,400 requests, one every 400 ms, same user agent as schedule.mjs.
 *
 * Output: public/illinois-offerings.json
 *   { terms: [{ id: "fa2026", year, term, subjects }], courses: { "FIN 423": ["fa2026", "sp2026", ...] } }
 * Written after every term, so a rerun resumes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = 'https://courses.illinois.edu/schedule';
const UA = 'TruBot/1.0 (+https://trumizzou.com; student project; respects robots.txt)';
const OUT = 'public/illinois-offerings.json';
const DELAY = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The Course Explorer answers a burst of requests with 202 and an empty
 * body, which is a polite "not now" rather than a page. Treated as a page it
 * read as "no courses this term" and emptied a whole season. So an empty
 * reply backs off, doubling from fifteen seconds, and the crawl paces itself
 * at 700 ms between requests to stay under the limit in the first place.
 */
async function get(url) {
  const waits = [15_000, 30_000, 60_000, 120_000, 240_000];
  for (let a = 0; a <= waits.length; a += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (res.status === 404) return null;
      const text = await res.text();
      if (res.status === 202 || (res.ok && text.length < 500)) throw new Error(`throttled (HTTP ${res.status}, ${text.length} bytes)`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return text;
    } catch (e) {
      if (a === waits.length) { console.log(`  ${url}: gave up: ${e.message}`); return null; }
      console.log(`  ${url}: ${e.message}; waiting ${waits[a] / 1000}s`);
      await sleep(waits[a]);
    }
  }
  return null;
}

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

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const done = new Map((prev?.terms ?? []).filter((t) => !t.missing && (t.courses ?? 0) > 0).map((t) => [t.id, t]));
const courses = prev?.courses ?? {};
const terms = [];
const knownSubjects = new Set(Object.keys(courses).map((code) => code.split(' ')[0]));
for (const want of termsWanted()) {
  if (done.has(want.id)) { terms.push(done.get(want.id)); console.log(`${want.id}: already read (${done.get(want.id).subjects} subjects)`); continue; }
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
  let listed = 0;
  let unreachable = 0;
  for (const subj of subjects) {
    const page = await get(`${BASE}/${want.year}/${want.term}/${subj}`);
    await sleep(DELAY);
    if (!page) { unreachable += 1; continue; }
    const nums = [...new Set([...page.matchAll(new RegExp(`href="/schedule/${want.year}/${want.term}/${subj}/(\\d{3})"`, 'g'))].map((m) => m[1]))];
    for (const num of nums) {
      const code = `${subj} ${num}`;
      const have = courses[code] ?? (courses[code] = []);
      if (!have.includes(want.id)) have.push(want.id);
      listed += 1;
    }
  }
  if (listed === 0) { console.log(`${want.id}: nothing read (${unreachable} subject pages unreachable); not recorded`); continue; }
  terms.push({ id: want.id, year: want.year, term: want.term, subjects: subjects.length, courses: listed, unreachable });
  console.log(`${want.id}: ${subjects.length} subjects, ${listed} course listings${unreachable ? `, ${unreachable} subject pages unreachable` : ''}`);
  mkdirSync('public', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ school: 'illinois', source: BASE, fetchedAt: new Date().toISOString(), terms, courses }));
}
const order = terms.map((t) => t.id);
for (const code of Object.keys(courses)) courses[code].sort((a, b) => order.indexOf(a) - order.indexOf(b));
writeFileSync(OUT, JSON.stringify({ school: 'illinois', source: BASE, fetchedAt: new Date().toISOString(), terms, courses }));
console.log(`\n${Object.keys(courses).length} courses seen across ${terms.filter((t) => !t.missing).length} terms`);
