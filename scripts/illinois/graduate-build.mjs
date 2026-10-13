/**
 * The graduate planner files, from crawls we already have.
 *
 *   node --experimental-strip-types scripts/illinois/graduate-build.mjs
 *
 * npm run build:illinois runs it after build-index.mjs, so the graduate files
 * are rebuilt every time the undergraduate ones are. It writes only under
 * public/illinois/graduate/ and never touches an undergraduate file.
 *
 * Courses. The course-catalog crawl (public/illinois-catalog.json) already
 * holds every course numbered 500 and up, with title, hours and prerequisite
 * text, read from the catalog's own course pages. build-index.mjs leaves them
 * out of the planner's course list on purpose (an undergraduate plan has no
 * use for them), so no new crawl is needed: this reads the same file with the
 * same adapter (adaptIllinoisCatalog with includeGraduate and includeNoise)
 * and writes
 *
 *   courses.json    one row per course numbered 500 and up, in the shape of
 *                   index.json's rows, plus `noise: true` on thesis research,
 *                   independent study and similar rows (a graduate program
 *                   names them; an elective pool must not draw on them)
 *   prereqs.json    their prerequisites, keeping the clauses written for
 *                   graduate students and dropping the ones written only for
 *                   undergraduates (the inverse of build-index.mjs)
 *   offerings.json  which recent terms each ran in (illinois-offerings.json)
 *   sections.json, sections/<term>.json  the crawled terms' sections
 *
 * Programs. public/illinois/graduate/crawl.json (scripts/illinois/graduate.mjs)
 * is read with lib/planner/illinois-graduate.ts, the reader the browser will
 * run, and written as
 *
 *   programs.json          the menu: one row per page, or per option of a page
 *                          that offers several, with its reading status
 *   program/<page id>.json one page each, as crawled (concentration pages too)
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
register(
  'data:text/javascript,' +
    encodeURIComponent(`
const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
  if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

const { adaptIllinoisCatalog, summariseSections, sectionTermOf, ILLINOIS_GRAD_LEVEL } = await import('../../lib/planner/illinois-data.ts');
const { adaptIllinoisGraduateProgram, graduateSummaryOf } = await import('../../lib/planner/illinois-graduate.ts');

const PUBLIC = join(ROOT, 'public');
const OUT = join(PUBLIC, 'illinois', 'graduate');
const normCode = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const read = (name) => (existsSync(join(PUBLIC, name)) ? JSON.parse(readFileSync(join(PUBLIC, name), 'utf8')) : null);
const write = (rel, value) => {
  const full = join(OUT, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(value));
  return full;
};

// ---------------------------------------------------------------------------
// Courses numbered 500 and up
// ---------------------------------------------------------------------------

const catalog = read('illinois-catalog.json');
if (!catalog) {
  console.error('public/illinois-catalog.json is missing; there is nothing to build from.');
  process.exit(1);
}
const adapted = adaptIllinoisCatalog(catalog, { includeGraduate: true, includeNoise: true });
const rawByCode = new Map((catalog.courses ?? []).map((r) => [normCode(r.code), r]));
const graduate = adapted.courses.filter((c) => (adapted.facts.get(normCode(c.code))?.level ?? 0) >= ILLINOIS_GRAD_LEVEL);

const courseRows = graduate.map((course) => {
  const code = normCode(course.code);
  const fact = adapted.facts.get(code);
  const row = { id: course.id, code: course.code, title: course.title, credits: course.credits, cluster: course.cluster, level: fact?.level ?? 0 };
  if (course.creditsMax !== undefined) row.creditsMax = course.creditsMax;
  if (course.tags?.length > 0) row.tags = course.tags;
  if (course.prerequisites?.length > 0) row.prerequisites = course.prerequisites;
  if (course.format === 'Online') row.online = true;
  const twins = (adapted.equivalents.get(code) ?? []).filter((t) => t !== code);
  if (twins.length > 0) row.twins = twins;
  if (course.repeat) row.repeat = course.repeat;
  if (rawByCode.get(code)?.noise) row.noise = true;
  return row;
});
courseRows.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
const gradCodes = new Set(courseRows.map((r) => normCode(r.code)));

/**
 * A clause the catalog writes for undergraduates alone is not a graduate
 * student's prerequisite ("For undergraduates: ANTH 220 ... For graduate
 * students: ..."): build-index.mjs drops the graduate clause for its list,
 * and this drops the undergraduate one for this list.
 */
const UNDERGRADUATE_ONLY = /^\s*(for )?undergraduates?( students)?( only)?\s*:/i;
const forGraduates = (spec) =>
  (spec.groups ?? []).some((g) => UNDERGRADUATE_ONLY.test(g.source ?? ''))
    ? { ...spec, groups: spec.groups.filter((g) => !UNDERGRADUATE_ONLY.test(g.source ?? '')) }
    : spec;
const prereqs = {};
for (const code of gradCodes) {
  const fact = adapted.facts.get(code);
  if (!fact?.prereq) continue;
  if (!fact.prereq.parsed && fact.prereq.text.length === 0 && !fact.prereq.note) continue;
  prereqs[code] = forGraduates(fact.prereq);
}

const offeringsRaw = read('illinois-offerings.json');
let offeringsCount = 0;
if (offeringsRaw) {
  const termIds = (offeringsRaw.terms ?? []).filter((t) => !t.missing && (t.courses ?? 0) > 0).map((t) => t.id);
  const courses = {};
  for (const row of courseRows) {
    const ran = (offeringsRaw.courses?.[row.code] ?? []).filter((t) => termIds.includes(t));
    if (ran.length) courses[row.code] = ran;
  }
  offeringsCount = Object.keys(courses).length;
  write('offerings.json', { source: offeringsRaw.source, fetchedAt: offeringsRaw.fetchedAt, terms: termIds, courses });
}

/** Each crawled term's sections for the graduate courses, summarised as build-index.mjs summarises the rest. */
const sectionCounts = [];
const sectionFiles = [['illinois-sections.json', 'sections.json'], ['illinois-sections-sp2027.json', null]];
rmSync(join(OUT, 'sections'), { recursive: true, force: true });
for (const [name, fixed] of sectionFiles) {
  const file = read(name);
  if (!file || file.complete === false || !Array.isArray(file.courses)) continue;
  const info = sectionTermOf(file);
  const rows = [];
  for (const course of file.courses) {
    if (!course?.code || !gradCodes.has(normCode(course.code))) continue;
    const { termId: _t, termLabel: _l, ...rest } = summariseSections(course, info);
    rows.push(rest);
  }
  write(fixed ?? `sections/${info.id}.json`, { termId: info.id, termLabel: info.label, capturedAt: info.fetchedAt, courses: rows });
  sectionCounts.push(`${info.label} ${rows.length}`);
}

write('courses.json', courseRows);
write('prereqs.json', prereqs);

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

const crawl = read('illinois/graduate/crawl.json');
if (!crawl) {
  console.error('public/illinois/graduate/crawl.json is missing: run node scripts/illinois/programs.mjs --graduate first.');
  process.exit(1);
}
// The reader's catalog: the undergraduate list the planner already loads, and the graduate rows.
const byCode = new Map();
for (const row of read('illinois/index.json') ?? []) byCode.set(normCode(row.code), row);
for (const row of courseRows) byCode.set(normCode(row.code), row);

rmSync(join(OUT, 'program'), { recursive: true, force: true });
const summaries = [];
for (const raw of crawl.programs) {
  write(`program/${raw.id}.json`, raw);
  if (raw.kind === 'concentration') continue;
  for (const reading of adaptIllinoisGraduateProgram(raw, byCode)) summaries.push(graduateSummaryOf(reading, raw));
}
write('programs.json', { school: 'illinois', source: crawl.source, fetchedAt: crawl.fetchedAt, programs: summaries });

// Codes the programs name that no course list has.
const named = new Set();
for (const raw of crawl.programs) for (const o of raw.options) for (const a of o.areas) for (const g of a.groups) for (const c of g.courses) { named.add(normCode(c.code)); for (const alt of c.or ?? []) named.add(normCode(alt)); }
const missing = [...named].filter((c) => !byCode.has(c));

const count = (pred) => summaries.filter(pred).length;
console.log(`graduate courses: ${courseRows.length} (${courseRows.filter((r) => r.noise).length} thesis/independent-study rows), ${Object.keys(prereqs).length} with prerequisites, ${offeringsCount} with an offering history; sections: ${sectionCounts.join(', ') || 'none'}`);
console.log(`graduate menu: ${summaries.length} rows from ${crawl.programs.filter((p) => p.kind !== 'concentration').length} pages; ${count((s) => s.status === 'reads right')} read right, ${count((s) => s.plannable)} plannable`);
console.log(`course codes the programs name that no course list has: ${missing.length}${missing.length ? ` (${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', ...' : ''})` : ''}`);
