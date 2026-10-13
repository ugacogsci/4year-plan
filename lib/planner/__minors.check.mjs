/**
 * The minors, read and planned: a scoreboard for all of them and hand-checked
 * fixtures for some.
 *
 * Run it with:  PATH="/opt/homebrew/opt/node@23/bin:$PATH" node lib/planner/__minors.check.mjs
 * It re-execs itself with the type-stripping flag. Exits non-zero on any failure.
 * MINORS_VERBOSE=1 prints every minor's row; MINORS_BEFORE=1 also scores the
 * degree reader alone (no minor-only readings), for a before and after.
 *
 * The scoreboard plans each minor by itself with the real engine
 * (generatePlan, four years from Fall 2026, 12 to 18 hours a term) and counts
 * the hours the plan books FOR the minor's own requirements (bookedFor), not
 * the prerequisites it adds. A minor "reads right" when those hours are within
 * one of the total its page states. A minor whose page states no total cannot
 * be checked that way and never counts as right.
 *
 * The beta list is the minors that read right, leave no requirement of their
 * own unmet or merely quoted, and are not teacher-education minors (licensure
 * rules a plan cannot show). It is what a first release could offer.
 *
 * Held here:
 *   - the crawl: every minor on the A to Z page, the three link traps (a
 *     leading space, Social Work's short path, the eng_bus college code), and
 *     no footnote marker left on a title;
 *   - totals read 12 to 30 from the page, the four ways pages state them;
 *   - no minor carries the campus gen-ed table or a language requirement, and
 *     every id starts with "minor:";
 *   - shapes (a) and (c) on the pages that use them, and the minors that
 *     already read right still read right;
 *   - the scoreboard does not fall below the floor recorded here.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

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

const { generatePlan } = await import('./autoplan.ts');
const { missingPrerequisiteGroups, attachRequirementIds } = await import('./illinois-data.ts');
const { adaptIllinoisMinors, readingHours, subjectHoursIn, subjectLevelIn, MINOR_ID_PREFIX, MINOR_BETA, MINORS_HELD_FROM_BETA } = await import('./illinois-minors.ts');
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import('./illinois-load.ts');
const { minorLinks, minorTotal } = await import('../../scripts/illinois/minors.mjs');

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
};

const pub = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const meta = pub('illinois/meta.json');
const rows = pub('illinois/index.json').map(hydrateIndexRow);
const offerings = pub('illinois/offerings.json');
applyOfferings(rows, offerings);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const gradeRaw = new Map(pub('illinois/grades.json').map((g) => [norm(g.code), g]));
const grades = new Map([...gradeRaw].map(([code, g]) => [code, toGradeRow(g, byCode.get(code)?.title ?? code, [])]));
const sectionFile = pub('illinois/sections.json');
const equivalents = new Map();
for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map();
for (const c of rows) {
  const max = c.creditsMax ?? c.credits;
  creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true });
}
const season = (meta.term?.term ?? 'fall').toLowerCase();
const context = {
  courses: rows,
  prereqs: new Map(Object.entries(pub('illinois/prereqs.json'))),
  grades,
  sections: new Map(sectionFile.courses.map((r) => [norm(r.code), { ...r, termId: sectionFile.termId, termLabel: sectionFile.termLabel }])),
  equivalents,
  exclusions: new Map(Object.entries(pub('illinois/exclusions.json'))),
  creditRanges,
  bands: meta.bands,
  offeringPublished: new Set(rows.map((c) => norm(c.code))),
  offerings: new Map(Object.entries(offerings.courses)),
  offeringTerms: offerings.terms,
  offeringAliases: offerings.renumbered ? new Map(Object.entries(offerings.renumbered)) : undefined,
  languages: pub('illinois/languages.json'),
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
};
const facts = new Map(rows.map((c) => [norm(c.code), { equivalents: (c.twins ?? []).map(norm), genEd: c.tags ?? [] }]));

const crawl = pub('illinois/minors/crawl.json');
const minors = adaptIllinoisMinors(crawl, byCode);
const byId = new Map(minors.map((m) => [m.catalogId, m]));

// ---------------------------------------------------------------- the crawl
console.log('THE CRAWL (public/illinois/minors/crawl.json)');
check(crawl.minors.length === 130, 'every minor on the A to Z page was read', `${crawl.minors.length}`);
check(byId.has('las/minors/south-asian-studies-interdisciplinary'), 'the link with a leading space is read');
check(byId.get('minors/socw')?.college === 'socw', "Social Work's one-segment-short path keeps a college", byId.get('minors/socw')?.college);
check(byId.has('eng_bus/minors/technology-management'), 'the eng_bus college code is read');
// A title ending in a digit the catalog's own title does not end in ("Acting 1" is THEA 170's real title).
const footnoted = crawl.minors
  .flatMap((m) => m.areas.flatMap((a) => a.groups.flatMap((g) => g.courses)))
  .filter((c) => /\s\d$/.test(c.title) && !(byCode.get(norm(c.code))?.title ?? '').endsWith(c.title.slice(-2)));
check(footnoted.length === 0, 'no course title ends in a footnote marker', footnoted.slice(0, 3).map((c) => `${c.code} "${c.title}"`).join(', '));
check(!JSON.stringify(crawl).includes('illinois.edu/undergraduate/minors/minors.pdf'), 'the PDF beside the list is not a minor');
const raw = JSON.stringify(crawl);
check(!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(raw) && !/\(?\b\d{3}\)?[ .-]\d{3}-\d{4}\b/.test(raw), 'no email address or phone number is stored');

const links = minorLinks(`<a href=" /undergraduate/las/minors/x-y/">X</a><a href="/undergraduate/minors/socw/">S</a><a href="/undergraduate/eng_bus/minors/t-m/">T</a><a href="/undergraduate/minors/">all</a><a href="/undergraduate/minors/minors.pdf">pdf</a><a href="/undergraduate/las/minors/x-y/">X again</a>`);
check(links.length === 3 && links[0].listedAs.length === 2, 'minorLinks: three minors, the duplicate merged, the list page and PDF left out', links.map((l) => l.path).join(' '));
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#160;|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const totals = [
  ['<p>Total Hours 18</p>', 18, 'total-row'],
  ['<p>Total Required Hours 15</p><p>Total Elective Hours 3</p><p>Total Hours 18</p>', 18, 'total-row'],
  ['<p>Total Hours (Minimum Required) 17</p>', 17, 'total-row'],
  ['<p>The minor requires 18 credit hours and offers</p>', 18, 'sentence'],
  ['<p>as long as the student completes at least 16 total credit hours for the minor.</p>', 16, 'sentence'],
  ['<p>Applicants must have completed at least 30 credit hours prior to applying.</p>', null, null],
  ['<p>Minimum 300- or 400- level credit hours 6</p>', null, null],
];
for (const [html, hours, from] of totals) {
  const got = minorTotal(html, text);
  check(got.hours === hours && got.from === from, `minorTotal ${JSON.stringify(text(html).slice(0, 60))}`, `${got.hours} ${got.from}`);
}
const stated = crawl.minors.filter((m) => m.totalCredits !== null).length;
check(stated >= 120, 'the stated total read on at least 120 of the 130 pages', `${stated}`);

// ---------------------------------------------------------------- the reading
console.log('\nTHE READING (lib/planner/illinois-minors.ts)');
const kinds = (m) => m.blocks.map((b) => b.rule.kind);
check(minors.every((m) => m.id.startsWith(MINOR_ID_PREFIX) && m.blocks.every((b) => b.id.startsWith(MINOR_ID_PREFIX) && b.areaId.startsWith(MINOR_ID_PREFIX))), 'every minor and block id starts with "minor:"');
const withGenEd = minors.filter((m) => kinds(m).some((k) => k === 'gened' || k === 'language'));
check(withGenEd.length === 0, 'no minor asks for the campus gen-ed table or a language semester', withGenEd.map((m) => m.catalogId).join(', '));

const ds = byId.get('las/minors/data-science');
const dsCore = ds.blocks.filter((b) => b.rule.kind === 'all').flatMap((b) => b.rule.choices.map((c) => c.codes[0]));
check(['STAT 107', 'STAT 207', 'CS 307'].every((c) => dsCore.includes(c)), '(a) Data Science: the three core courses printed as headings are required rows', dsCore.join(', '));
check(!ds.blocks.some((b) => b.rule.kind === 'hours'), '(a) Data Science: no unnamed hours left');

const hort = byId.get('aces/minors/horticulture');
const hortPool = hort.blocks.find((b) => b.rule.kind === 'pool' && b.rule.choices.some((c) => c.codes[0].startsWith('HORT')));
check(hortPool?.rule.hours === 11 && !hortPool.rule.choices.some((c) => ['HORT 393', 'HORT 395', 'HORT 100'].includes(c.codes[0])), '(c) Horticulture: 11 hours of HORT, less the two excluded and the ones already named', `${hortPool?.rule.hours}`);
const aas = byId.get('las/minors/asian-american-studies');
const aasPool = aas.blocks.find((b) => b.rule.kind === 'pool' && b.rule.choices.every((c) => c.codes[0].startsWith('AAS ')));
check(aasPool?.rule.hours === 6, '(c) Asian American Studies: 6 hours of AAS coursework', `${aasPool?.rule.hours}`);
const mus = byId.get('faa/minors/music');
const musPool = mus.blocks.find((b) => b.rule.kind === 'pool' && b.label === 'Music Electives');
check(musPool?.rule.hours === 6 && musPool.rule.choices.some((c) => c.codes[0].startsWith('MUSC ')), '(c) Music: the 6 elective hours are any MUS or MUSC course', `${musPool?.rule.hours}`);

const sh = (t) => subjectHoursIn(t);
check(sh('Select a minimum of 9 hours from any HORT courses (excluding HORT 393 and HORT 395 ).')?.excluded.length === 2, 'subjectHoursIn: exclusions read');
check(sh('Six hours of 300- or 400-level courses in Anthropology (ANTH).') === null, 'subjectHoursIn: a level sentence is the level shape, not this one');
check(sh('Select 3 hours from any CPSC, HORT, or PLPA course (excluding CPSC 393 / HORT 393).')?.subjects.length === 3, 'subjectHoursIn: three subjects in one phrase');
check(sh('Minimum 18 hours of Spanish Courses')?.subjects.join() === 'SPAN', 'subjectHoursIn: a subject written out');

// (b) subject-and-level comment rows (2026-10-13).
const sl = (t, h) => subjectLevelIn(t, h);
check(sl('Select two 300- or 400- level Psychology courses', 6)?.subjects.join() === 'PSYC' && sl('Select two 300- or 400- level Psychology courses', 6)?.levels.join() === '3,4', 'subjectLevelIn: "two 300- or 400-level Psychology courses" is PSYC at 300/400');
check(sl('Sociology (SOC) courses at the 300- or 400-level', 7)?.subjects.join() === 'SOC', 'subjectLevelIn: a prefix in parentheses');
check(sl('Select two additional 100- or 200-level Political Science courses', 6)?.subjects.join() === 'PS', 'subjectLevelIn: a two-word department name');
check(sl('Six REL courses, at least 6 hours at the 300- or 400-level, no more than 6 hours at the 100-level', 18) === null, 'subjectLevelIn: a row with "at least" and "no more than" is left as it was');
check(sl('Select at least 10 hours of advanced geology courses from the following:', 10) === null, 'subjectLevelIn: a row that points at a list is left as it was');
check(sl('Select two 300- or 400- level Psychology courses', null) === null, 'subjectLevelIn: no hours, no row');
const psyc = byId.get('las/minors/psychology');
const psycUpper = psyc.blocks.find((b) => b.rule.kind === 'pool' && b.rule.hours === 6 && b.rule.choices.every((c) => /^PSYC [34]/.test(c.codes[0])));
check(Boolean(psycUpper) && !psycUpper.rule.choices.some((c) => ['PSYC 340', 'PSYC 341', 'PSYC 398', 'PSYC 492', 'PSYC 494', 'PSYC 498', 'PSYC 499'].includes(c.codes[0])), '(b) Psychology: 6 hours of 300/400-level PSYC, less the courses its page says do not count');
const wfc = byId.get('aces/minors/wildlife-fisheries-conservation');
check(!wfc.readAsOneList && wfc.blocks.filter((b) => b.rule.kind === 'choose' && b.rule.n === 1).length === 3, '(f) Wildlife & Fisheries Conservation: its one list split into the required rows and three "Pick one" choices', wfc.readings.join('; '));
const soc = byId.get('las/minors/sociology');
check(soc.blocks.some((b) => b.rule.kind === 'pool' && b.rule.hours === 7 && b.rule.choices.every((c) => /^SOC [34]/.test(c.codes[0]))), '(b) Sociology: 7 hours of 300/400-level SOC');

// ---------------------------------------------------------------- the plans
const HORIZON = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true };
const PRIOR = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true };
const credit = (code) => byCode.get(norm(code))?.credits ?? 0;

function score(reading) {
  for (const r of rows) r.requirementIds = [];
  attachRequirementIds(rows, reading.blocks, facts);
  const g = generatePlan({
    requirements: reading.blocks,
    context,
    prior: PRIOR,
    horizon: HORIZON,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 } },
    programId: reading.id,
    degreeTotal: null,
    programName: reading.name,
    programCollege: reading.college,
  });
  const booked = Object.entries(g.bookedFor ?? {}).filter(([, req]) => req && String(req).startsWith(MINOR_ID_PREFIX)).map(([code]) => code);
  const planned = booked.reduce((n, code) => n + credit(code), 0);
  const unmet = g.unsatisfied.filter((u) => u.requirementId.startsWith(MINOR_ID_PREFIX) && u.reason !== 'filled-by-electives');
  const quoted = reading.blocks.filter((b) => b.rule.kind === 'unparsed');
  const read = readingHours(reading.blocks, byCode);
  // Hours that match only because the whole minor was read as one list are not a reading.
  const right = reading.totalCredits !== null && !reading.readAsOneList && Math.abs(read - reading.totalCredits) <= 1;
  return { reading, read, planned, booked, unmet, quoted, right };
}

const t0 = Date.now();
const scored = minors.map(score);
const seconds = Math.round((Date.now() - t0) / 1000);
const right = scored.filter((s) => s.right);
/**
 * Could a beta offer it? The reading is right, and the engine's own plan of
 * the minor alone agrees: it meets every row (a quoted sentence aside: it is
 * shown to the student as the catalog's words) and books no fewer hours than
 * the page states, less one, and no more than four over, which is a 3-hour
 * list taken as its 4-hour course (Statistics: STAT 107 for STAT 100). More
 * than that is a reading whose hours add up by chance (Kinesiology reads one
 * course from each of five areas, 20 hours, where the page asks for three
 * from one); fewer is a course the page asks for twice (International
 * Business: BADM 383 under two topics), which the engine books once.
 */
const offerable = (s) =>
  s.right &&
  !s.reading.teacherEducation &&
  !MINORS_HELD_FROM_BETA[s.reading.catalogId] &&
  s.unmet.every((u) => u.reason === 'not-parsed') &&
  s.planned >= s.reading.totalCredits - 1 &&
  s.planned <= s.reading.totalCredits + 4;
const beta = scored.filter(offerable);
const verbose = process.env.MINORS_VERBOSE === '1';
console.log(`\nTHE SCOREBOARD (each minor planned alone, ${seconds}s)`);
for (const s of scored) {
  if (!verbose && s.right) continue;
  const r = s.reading;
  const why = r.totalCredits === null ? 'no stated total' : r.readAsOneList ? 'one list' : s.right ? 'right' : s.read < r.totalCredits ? 'short' : 'long';
  console.log(`  ${why.padEnd(15)} ${String(r.totalCredits ?? '?').padStart(2)} stated, ${String(s.read).padStart(2)} read, ${String(s.planned).padStart(2)} booked  ${r.catalogId}${s.unmet.length ? `  unmet ${s.unmet.length}` : ''}${s.quoted.length ? `  quoted ${s.quoted.length}` : ''}${r.readings.length ? `  [${r.readings.join('; ')}]` : ''}`);
}
for (const id of (process.env.MINORS_SHOW ?? '').split(',').filter(Boolean)) {
  const s = scored.find((x) => x.reading.catalogId.includes(id));
  if (!s) continue;
  console.log(`\n  ${s.reading.catalogId}: read ${s.read}, booked ${s.booked.map((c) => `${c} ${credit(c)}`).join(', ')}`);
  for (const b of s.reading.blocks) console.log(`    ${b.rule.kind.padEnd(8)} ${String(b.hours ?? '-').padStart(3)}h n=${b.rule.n ?? '-'} ${(b.rule.choices ?? []).length} choices  ${b.label.slice(0, 70)}`);
  for (const u of s.unmet) console.log(`    UNMET ${u.reason}: ${u.label.slice(0, 80)}`);
}
console.log(`\n  ${right.length} of ${minors.length} minors read within one hour of the total their page states`);
console.log(`  ${scored.filter((s) => s.reading.totalCredits === null).length} pages state no total; ${scored.filter((s) => s.reading.readAsOneList).length} read as one list; ${scored.filter((s) => s.reading.totalCredits !== null && !s.reading.readAsOneList && !s.right && s.read < s.reading.totalCredits).length} read short; ${scored.filter((s) => s.reading.totalCredits !== null && !s.reading.readAsOneList && !s.right && s.read > s.reading.totalCredits).length} read long`);
console.log(`  the engine's own plan of each minor alone books within one hour of the stated total for ${scored.filter((s) => s.reading.totalCredits !== null && Math.abs(s.planned - s.reading.totalCredits) <= 1).length}, and leaves a minor row unmet in ${scored.filter((s) => s.unmet.length > 0).length}`);
console.log(`  beta list (read right, the engine's plan agrees, not teacher education): ${beta.length}`);
console.log(`    ${beta.map((s) => s.reading.name.replace(/ Minor$/, '')).join(', ')}`);
if (verbose) console.log(`    ids: ${beta.map((s) => s.reading.catalogId).join(',')}`);

if (process.env.MINORS_BEFORE === '1') {
  const before = adaptIllinoisMinors(crawl, byCode, { shapes: false }).map(score);
  const rightBefore = before.filter((s) => s.right);
  console.log(`\n  before the minor-only readings: ${rightBefore.length} of ${before.length} within one hour; beta ${before.filter(offerable).length}`);
}

// The seven the research found already reading right (DESIGN.md section 2) still do.
console.log('\nFIXTURES');
const fixtures = [
  ['aces/minors/leadership-studies', 17],
  ['las/minors/mathematics', 19],
  ['las/minors/statistics', 17],
  ['media/minors/journalism', 18],
  ['minors/socw', 18],
  ['faa/minors/music', 18],
  ['bus/minors/business-non-business', 18],
  ['las/minors/data-science', 21],
  ['aces/minors/horticulture', 18],
  ['las/minors/asian-american-studies', 18],
  // Read by hand against their pages, 2026-10-09.
  ['media/minors/public-relations', 18],
  ['engineering/minors/physics', 21],
  ['las/minors/geology', 18],
  ['ahs/minors/speech-hearing-science', 17],
  // Read since shape (b), 2026-10-13; pages read by hand the same day.
  ['las/minors/psychology', 18],
  ['las/minors/sociology', 18],
  ['las/minors/political-science', 18],
  // Shape (f): its one list split at its own "Pick one:" rows.
  ['aces/minors/wildlife-fisheries-conservation', 17],
];
const scoredById = new Map(scored.map((s) => [s.reading.catalogId, s]));
for (const [id, hours] of fixtures) {
  const s = scoredById.get(id);
  check(s?.reading.totalCredits === hours && s.right, `${id}: ${hours} stated, read within one`, `${s?.reading.totalCredits} stated, ${s?.read} read, ${s?.planned} booked`);
}
// Chemistry's "CHEM 102-105 or CHEM 202-205" is read as one ten-course list (DESIGN.md section 2): its
// hours match by construction, so it must not count as right or be offered.
const chem = scoredById.get('las/minors/chemistry');
check(chem?.reading.readAsOneList && !chem.right && !MINOR_BETA.includes('las/minors/chemistry'), 'las/minors/chemistry: read as one list, not counted right, not offered');
// Read right by hours, wrong in a way the hours cannot show: held by hand, never offered.
for (const id of ['las/minors/creative-writing', 'aces/minors/military-leadership']) {
  check(Boolean(MINORS_HELD_FROM_BETA[id]) && !MINOR_BETA.includes(id), `${id}: held from the beta (${MINORS_HELD_FROM_BETA[id]?.slice(0, 50)}...)`);
}
// Kinesiology's hours come out 20 by chance (one course from each of five areas); the engine books 27.
check(!MINOR_BETA.includes('ahs/minors/kinesiology'), 'ahs/minors/kinesiology: not offered (the plan books 27 hours for a 21-hour minor)');
// Known wrong today, held so a change that fixes or worsens them is seen (shapes b, d, e).
const knownWrong = [
  ['las/minors/economics', 'long'],
  ['las/minors/spanish', 'short'],
  ['informatics-programs/minors/informatics', 'long'],
];
for (const [id, way] of knownWrong) {
  const s = scoredById.get(id);
  const got = !s ? 'missing' : s.right ? 'right' : s.read > (s.reading.totalCredits ?? 99) ? 'long' : 'short';
  check(got === way || got === 'right', `${id}: still ${way} (shape not read yet) or now right`, got);
}

const computed = beta.map((s) => s.reading.catalogId).sort();
const listed = [...MINOR_BETA].sort();
const added = computed.filter((id) => !listed.includes(id));
const dropped = listed.filter((id) => !computed.includes(id));
check(added.length === 0 && dropped.length === 0, 'MINOR_BETA is the beta list this crawl gives', [added.length ? `now offerable: ${added.join(', ')}` : '', dropped.length ? `no longer: ${dropped.join(', ')}` : ''].filter(Boolean).join('; '));
check(Object.keys(MINORS_HELD_FROM_BETA).every((id) => byId.has(id)), 'every held minor is in the crawl');

// 44 on the crawl of 2026-10-09 (40 with the degree reader alone); 50 with shapes (b) and (f), 2026-10-13.
const FLOOR = Number(process.env.MINORS_FLOOR ?? 50);
check(right.length >= FLOOR, `the scoreboard holds its floor (${FLOOR})`, `${right.length}`);

console.log(failures ? `\n${failures} FAILED` : '\nall minors checks pass');
process.exit(failures ? 1 : 0);
