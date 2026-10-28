/**
 * UGA's Schedule of Classes as the planner reads it (uga-offerings.ts over
 * public/uga/course-offerings.json, built by scripts/uga/schedule-build.mjs).
 * Fails when:
 *
 *   1. the file does not load, lacks a term from Spring 2026 to Summer 2027,
 *      names a source off reg.uga.edu, or is 3 MB or more;
 *   2. well-known courses are not what the schedule shows: MATH 2250, CSCI
 *      1302 and HIST 2111 with several sections and instructors in Spring
 *      2027, ENGL 1101 with several in Fall 2026, and HIST 2301 (in the
 *      catalog, on no schedule in the file) offered nowhere;
 *   3. 5% or more of the sections sit under codes that are not planner course
 *      ids (the misses are printed), or notInCatalog is not exactly those;
 *   4. totals are not sane: a course's instructors and unnamed sections, or
 *      its campuses, do not add up to its sections; a term's sections or
 *      students are not the sum of its courses'; enrollment shows for a term
 *      whose registration has not opened; a version has more sections than
 *      its course;
 *   5. the lookups read a code differently from the build (online, honors,
 *      writing and service-learning versions under the course; a lab the
 *      catalog lists on its own kept apart; a lab or discussion booked with
 *      its lecture counted apart), say "not offered" for a term the file
 *      does not cover or a subject still being posted, or the browser loader
 *      does not fetch once and retry after a failure.
 *
 *   node lib/planner/__uga-offerings.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

const ROOT = join(HERE, '..', '..');
const O = await import(join(HERE, 'uga-offerings.ts'));
const C = await import(join(HERE, 'uga-course-codes.ts'));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? `: ${detail}` : ''}`));

const PATH = join(ROOT, 'public', 'uga', 'course-offerings.json');
const file = JSON.parse(readFileSync(PATH, 'utf8'));
const catalog = JSON.parse(readFileSync(join(ROOT, 'public', 'uga-catalog.json'), 'utf8'));
// Planner course ids, as components/planner/uga-source.tsx makes them (adaptCourses).
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const plannerIds = new Set(catalog.flatMap((row) => C.listedUgaCourseCodes(row.code)).map(slug));

// ---------------------------------------------------------------------------
console.log('1. the file');
const bytes = statSync(PATH).size;
expect(bytes < 3_000_000, `under 3 MB (${(bytes / 1e6).toFixed(2)} MB)`);
expect(file.school === 'uga' && /Registrar/.test(file.source) && file.page === 'https://reg.uga.edu/registration/schedule-of-classes/', 'says it is UGA\'s Schedule of Classes, with the Registrar\'s page');
expect(/^\d{4}-\d{2}-\d{2}$/.test(file.collectedAt), `collectedAt ${file.collectedAt}`);
const labels = file.terms.map((t) => t.label);
for (const want of ['Summer 2027', 'Spring 2027', 'Fall 2026', 'Summer 2026', 'Spring 2026']) expect(labels.includes(want), `covers ${want}`);
expect(labels.join() === [...file.terms].sort((a, b) => b.period.localeCompare(a.period)).map((t) => t.label).join(), 'terms newest first', labels.join(', '));
expect(file.terms.every((t) => /^https:\/\/reg\.uga\.edu\/(wp-admin\/admin-ajax\.php\?action=soc_csv&term=(fall|spring|summer)|wp-content\/uploads\/[\w.-]+\.csv)$/.test(t.url)), 'every term read from reg.uga.edu (the page\'s relay or a final file)', file.terms.map((t) => t.url).join(' '));
expect(file.terms.find((t) => t.label === 'Spring 2026')?.status === 'final' && file.terms.find((t) => t.label === 'Summer 2026')?.status === 'final', 'Spring and Summer 2026 are final');
expect(file.terms.find((t) => t.label === 'Spring 2027')?.status === 'upcoming', 'Spring 2027 is upcoming');
for (const t of file.terms) console.log(`        ${t.label} (${t.status}, read ${t.fetchedAt}): ${t.courses} courses, ${t.sections} sections, ${t.instructors} instructors, ${t.enrolled} enrolled${t.stillPosting ? `; still posting ${t.stillPosting.join(' ')}` : ''}`);

// ---------------------------------------------------------------------------
console.log('2. well-known courses');
const several = (code, term, min = 2) => {
  const o = O.offeringsFor(file, code)?.byTerm[term];
  const people = O.instructorsFor(file, code, term);
  expect(o && o.sections >= min && people.length >= min, `${code} in ${term}: several sections and instructors`, o ? `${o.sections} sections, ${people.length} instructors` : 'not listed');
  return people;
};
const math = several('MATH 2250', 'Spring 2027', 10);
several('CSCI 1302', 'Spring 2027');
several('HIST 2111', 'Spring 2027');
several('ENGL 1101', 'Fall 2026', 10);
console.log(`        MATH 2250, Spring 2027: ${math.slice(0, 4).map((p) => `${p.name} x${p.sections}`).join(', ')}, ...`);
expect(math.every((p) => /^\p{Lu}[\p{L}'.-]*( [\p{L}'.-]+)+$/u.test(p.name) && p.name !== p.name.toUpperCase()), 'instructor names read "First Last"');
expect(O.offeredIn(file, 'ENGL 1101', 'Spring 2027') === true, 'ENGL 1101 listed in Spring 2027 (a fall course; one section so far)');
expect(catalog.some((row) => row.code === 'HIST 2301'), 'HIST 2301 is in the catalog');
expect(O.offeringsFor(file, 'HIST 2301') === null && O.termsOffered(file, 'HIST 2301').length === 0, 'HIST 2301 is on no schedule in the file');
expect(O.offeredIn(file, 'HIST 2301', 'Spring 2026') === false && O.offeredIn(file, 'HIST 2301', 'Fall 2026') === false, 'HIST 2301 not offered in a final or running term');
expect(O.offeredIn(file, 'MATH 2250', 'Fall 2025') === null, 'a term the file does not cover is unknown, not "not offered"');
const enrolled = O.enrollmentOf(file, 'MATH 2250');
expect(enrolled?.term === 'Fall 2026' && enrolled.enrolled > 300 && enrolled.seats >= enrolled.enrolled * 0.8, 'MATH 2250 enrollment: the newest term with students counted', JSON.stringify(enrolled));
expect(O.enrollmentOf(file, 'MATH 2250', 'Spring 2027') === null, 'no enrollment for a term whose registration has not opened');
expect(O.onMainCampus(file, 'MATH 2250', 'Fall 2026') && !O.onMainCampus(file, 'GENE 3200', 'Summer 2026'), 'Athens campus: MATH 2250 in the fall, not GENE 3200 online in the summer');

// ---------------------------------------------------------------------------
console.log('3. codes are planner course ids');
const sectionsOf = (code) => Object.values(file.courses[code]).reduce((n, o) => n + o.sections, 0);
let all = 0;
const missed = [];
for (const code of Object.keys(file.courses)) {
  const n = sectionsOf(code);
  all += n;
  if (!plannerIds.has(slug(code))) missed.push([code, n]);
}
const share = missed.reduce((n, [, k]) => n + k, 0) / all;
missed.sort((a, b) => b[1] - a[1]);
expect(share < 0.05, `${((1 - share) * 100).toFixed(1)}% of ${all} sections under planner course ids`, `${(share * 100).toFixed(1)}% missed`);
console.log(`        missed: ${missed.length} codes, most sections: ${missed.slice(0, 15).map(([c, n]) => `${c} (${n})`).join(', ')}`);
expect(missed.map(([c]) => c).sort().join() === [...file.notInCatalog].sort().join(), 'notInCatalog names exactly the codes the catalog does not list');
expect(['MATH 2250E', 'MATH 2250H', 'ENGL 1101E', 'ENGL 1101S', 'HIST 2111H', 'CSCI 1302H'].every((c) => !file.courses[c]), 'online, honors and service-learning versions are under their course, not apart');
expect(Boolean(file.courses['CHEM 1211L']) && !file.courses['PHYS 1111L'] && (file.courses['PHYS 1111']['Fall 2026'].parts?.L ?? 0) > 5, 'CHEM 1211L (its own course) kept apart; PHYS 1111L labs counted as parts of PHYS 1111');

// ---------------------------------------------------------------------------
console.log('4. totals');
const bad = [];
const termSum = new Map(file.terms.map((t) => [t.label, { sections: 0, enrolled: 0, courses: 0 }]));
for (const [code, byTerm] of Object.entries(file.courses)) {
  for (const [label, o] of Object.entries(byTerm)) {
    const term = file.terms.find((t) => t.label === label);
    if (!term) { bad.push(`${code} ${label}: not a term in the file`); continue; }
    const named = (o.instructors ?? []).reduce((n, [, k]) => n + k, 0);
    if (o.instructors && named + (o.unnamed ?? 0) !== o.sections) bad.push(`${code} ${label}: instructors ${named} + unnamed ${o.unnamed ?? 0} != ${o.sections} sections`);
    if (!o.instructors && !(o.individual && o.supervisors !== undefined)) bad.push(`${code} ${label}: no instructors and not a graduate one-to-one course`);
    const onCampus = o.campuses ? Object.values(o.campuses).reduce((a, b) => a + b, 0) : o.sections;
    if (onCampus !== o.sections) bad.push(`${code} ${label}: campuses ${onCampus} != ${o.sections}`);
    if (o.campuses && Object.keys(o.campuses).some((c) => !file.campuses[c])) bad.push(`${code} ${label}: an unnamed campus`);
    if ((term.enrolled > 0) !== (o.enrolled !== undefined)) bad.push(`${code} ${label}: enrollment ${o.enrolled} for a term with ${term.enrolled}`);
    if (o.enrolled !== undefined && o.enrolled > o.seats * 1.5 + 50 + (o.noLimit ?? 0) * 999) bad.push(`${code} ${label}: ${o.enrolled} students in ${o.seats} seats`);
    for (const [v, x] of Object.entries(o.versions ?? {})) if (x.sections > o.sections || !/^[EHWS]$/.test(v)) bad.push(`${code} ${label}: version ${v} ${x.sections} of ${o.sections}`);
    for (const p of Object.keys(o.parts ?? {})) if (!/^[LD]$/.test(p)) bad.push(`${code} ${label}: part ${p}`);
    const s = termSum.get(label);
    s.sections += o.sections;
    s.enrolled += o.enrolled ?? 0;
    if (o.sections > 0) s.courses += 1;
  }
}
expect(bad.length === 0, 'every course entry adds up', bad.slice(0, 8).join('; '));
for (const t of file.terms) {
  const s = termSum.get(t.label);
  expect(s.sections === t.sections && s.enrolled === t.enrolled && s.courses === t.courses, `${t.label}: term totals are the sum of its courses`, JSON.stringify(s));
}
const regular = file.terms.filter((t) => !t.label.startsWith('Summer'));
expect(regular.every((t) => t.courses > 4000 && t.sections > 15000 && t.instructors > 2000), 'each fall and spring: over 4,000 courses, 15,000 sections, 2,000 instructors');
expect(file.terms.filter((t) => t.status !== 'upcoming' && !t.label.startsWith('Summer')).every((t) => t.enrolled > 150_000 && t.enrolled < 300_000), 'a fall or spring in session or over: 150,000-300,000 enrollments');
expect(file.terms.filter((t) => t.status === 'upcoming').every((t) => t.enrolled === 0 || t.enrolled < 300_000), 'upcoming terms: registration not open, or a sane count');

// ---------------------------------------------------------------------------
console.log('5. lookups');
const mini = {
  school: 'uga', source: 'test', page: '', collectedAt: '2026-10-28', campuses: { ATH: 'Athens', ONL: 'Online' }, notInCatalog: [],
  terms: [
    { label: 'Spring 2027', period: '202702', status: 'upcoming', url: '', fetchedAt: '2026-10-28', enrolled: 0, courses: 2, sections: 3, instructors: 2, stillPosting: ['FYOS'] },
    { label: 'Fall 2026', period: '202608', status: 'in session', url: '', fetchedAt: '2026-10-28', enrolled: 90, courses: 3, sections: 5, instructors: 3 },
  ],
  courses: {
    'MATH 2250': {
      'Spring 2027': { sections: 2, seats: 80, instructors: [['Ann Lee', 2]] },
      'Fall 2026': { sections: 3, enrolled: 60, seats: 90, campuses: { ATH: 2, ONL: 1 }, instructors: [['Ann Lee', 1], ['Bo Kim', 1]], unnamed: 1, versions: { E: { sections: 1, instructors: [['Bo Kim', 1]] } } },
    },
    'PHYS 1111': { 'Fall 2026': { sections: 1, enrolled: 30, seats: 40, instructors: [['Cy Diaz', 1]], parts: { L: 3 } } },
    'FYOS 1001': { 'Fall 2026': { sections: 1, enrolled: 0, seats: 20, instructors: [], unnamed: 1 } },
    'CHEM 1211L': { 'Spring 2027': { sections: 1, seats: 24, instructors: [], unnamed: 1 } },
  },
};
const catalogKnows = (c) => ['MATH 2250', 'MATH 2250E', 'PHYS 1111', 'CHEM 1211', 'CHEM 1211L', 'GENE 3200'].includes(c);
const keys = ['MATH 2250E', 'MATH 2250H', 'CHEM 1211L', 'PHYS 1111L', 'GENE 3200D', 'PHYS 1111-1111L', 'math 2250', 'SABD 1367'].map((c) => O.offeringKeyOf(c, catalogKnows));
expect(JSON.stringify(keys) === JSON.stringify([
  { key: 'MATH 2250', version: 'E' }, { key: 'MATH 2250', version: 'H' }, { key: 'CHEM 1211L' }, { key: 'PHYS 1111', part: 'L' },
  { key: 'GENE 3200', part: 'D' }, { key: 'PHYS 1111' }, { key: 'MATH 2250' }, { key: 'SABD 1367' },
]), 'codes: versions under the course (even one the catalog lists), a listed lab kept, a booked lab or discussion a part, joint rows by their first code', JSON.stringify(keys));
expect(O.offeredIn(mini, 'MATH 2250E', 'Fall 2026') === true && O.offeredIn(mini, 'MATH 2250E', 'Spring 2027') === false && O.offeredIn(mini, 'MATH 2250', 'Spring 2027') === true, 'a version code answers for that version');
expect(O.offeredIn(mini, 'PHYS 1111L', 'Fall 2026') === true && O.instructorsFor(mini, 'PHYS 1111L').length === 0, 'a lab part: offered with its lecture, no instructors of its own');
expect(O.offeredIn(mini, 'FYOS 1002', 'Spring 2027') === null && O.offeredIn(mini, 'FYOS 1002', 'Fall 2026') === false && O.offeredIn(mini, 'PHYS 1111', 'Spring 2027') === false, 'missing from an upcoming term: unknown while its subject is still being posted, else not offered');
expect(O.offeredIn(mini, 'MATH 2250', 'Summer 2027') === null, 'a term not in the file: null');
const people = O.instructorsFor(mini, 'MATH 2250');
expect(JSON.stringify(people) === JSON.stringify([{ name: 'Ann Lee', sections: 3, terms: ['Spring 2027', 'Fall 2026'] }, { name: 'Bo Kim', sections: 1, terms: ['Fall 2026'] }]), 'instructors across terms: sections summed, newest term first', JSON.stringify(people));
expect(JSON.stringify(O.instructorsFor(mini, 'MATH 2250E', 'Fall 2026')) === JSON.stringify([{ name: 'Bo Kim', sections: 1, terms: ['Fall 2026'] }]), 'instructors of one version');
expect(JSON.stringify(O.enrollmentOf(mini, 'MATH 2250')) === JSON.stringify({ term: 'Fall 2026', status: 'in session', sections: 3, enrolled: 60, seats: 90, noLimit: 0 }), 'enrollment skips a term whose registration has not opened');
expect(O.onMainCampus(mini, 'MATH 2250', 'Spring 2027') && O.onMainCampus(mini, 'MATH 2250', 'Fall 2026') && !O.onMainCampus(mini, 'MATH 2250', 'Summer 2027'), 'no campuses means all on the Athens campus');
expect(JSON.stringify(O.termsOffered(mini, 'MATH 2250E')) === '["Fall 2026"]' && O.offeringsFor(mini, 'CHEM 1211')?.key === undefined, 'termsOffered per version; CHEM 1211 is not CHEM 1211L');

let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async () => {
  calls += 1;
  if (calls === 1) throw new Error('offline');
  return new Response(readFileSync(PATH, 'utf8'));
};
const first = await O.loadUgaOfferings();
const second = await O.loadUgaOfferings();
const third = await O.loadUgaOfferings();
globalThis.fetch = realFetch;
expect(first === null && second?.terms?.length === file.terms.length && third === second && calls === 2, 'the browser loader: a failure is asked again, a success fetched once', `calls ${calls}`);

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
