/**
 * The notes a plan tells a student about itself, checked against the plan.
 *
 * A note is a claim. "One hardest-band course a term would cost this plan
 * courses it could not place" was printed to a Mechanical Engineering
 * freshman whose plan placed everything; "Hard courses are spread one to a
 * term wherever the degree allows it" was printed over an Economics last
 * term holding MATH 441 and MATH 446; "2 credits beyond the 128 this degree
 * takes keep every term at the 12 you set as a minimum" was printed to a
 * student whose terms ran 15 to 17. Each case below ties a note to the
 * numbers it names, so the note cannot drift from the board again.
 *
 *   node lib/planner/__plan-notes.check.mjs
 *
 * Loaded the way the browser loads it, like __plan-audit.check.mjs.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

const { generatePlan, spreadHardOutcome, describeBeyondTotal } = await import(join(HERE, 'autoplan.ts'));
const { buildIllinoisData, gradeFootnote, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { applyOfferings } = await import(join(HERE, 'illinois-load.ts'));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);

// ---------------------------------------------------------------------------
console.log('\n=== 1. spread_hard: the note names what happened ===\n');

/** Just enough of a GeneratedPlan for spreadHardOutcome. */
const term = (label, codes, hard, extra = {}) => ({ label, codes, load: { hard, bandVerdict: hard.length >= 2 ? 'heavy' : 'normal', avgDifficulty: 20, ...extra } });
const planOf = (terms, extra = {}) => ({ terms, notPlaced: [], unsatisfied: [], credits: { planned: { min: 120 } }, ...extra });
const OLD_FALSE = /courses it could not place|another term|wherever the degree allows/;
{
  // The Mechanical Engineering shape: nothing left out, one term harder.
  const base = planOf([term('Fall 2026', ['MATH 221', 'MATH 112'], ['MATH 221', 'MATH 112']), term('Fall 2027', ['MATH 241', 'PHYS 212'], ['MATH 241', 'PHYS 212'])]);
  const spread = planOf([term('Fall 2026', ['MATH 221'], ['MATH 221']), term('Fall 2027', ['MATH 241', 'MATH 112', 'PHYS 212'], ['MATH 241', 'MATH 112', 'PHYS 212'])]);
  const out = spreadHardOutcome(base, spread);
  if (!out.adopt && /put 3 hardest-band courses in Fall 2027 \(MATH 241, MATH 112, PHYS 212\)/.test(out.note) && !OLD_FALSE.test(out.note)) ok('a harder term is named with its term and its courses');
  else fail(`harder term: ${JSON.stringify(out)}`);
}
{
  // The Computer Engineering with AP shape: two terms and nineteen credits.
  const six = ['Fall 2026', 'Spring 2027', 'Fall 2027', 'Spring 2028', 'Fall 2028', 'Spring 2029'].map((l) => term(l, ['X 100'], []));
  const eight = [...six, term('Fall 2029', ['X 200'], []), term('Spring 2030', ['X 300'], [])];
  const out = spreadHardOutcome(planOf(six, { credits: { planned: { min: 89 } } }), planOf(eight, { credits: { planned: { min: 108 } } }));
  if (!out.adopt && /add 2 terms and 19 credits, finishing in Spring 2030 instead of Spring 2029/.test(out.note) && !OLD_FALSE.test(out.note)) ok('added terms are counted, with the credits and the finish');
  else fail(`terms added: ${JSON.stringify(out)}`);
}
{
  const base = planOf([term('Fall 2026', ['A 100'], [])]);
  const spread = planOf([term('Fall 2026', ['A 100'], [])], { notPlaced: [{ code: 'ME 461' }, { code: 'ME 470' }] });
  const out = spreadHardOutcome(base, spread);
  if (!out.adopt && /leave 2 more courses unplaced \(ME 461, ME 470\)/.test(out.note)) ok('courses left unplaced are counted and named');
  else fail(`not placed: ${JSON.stringify(out)}`);
}
{
  const same = [term('Fall 2026', ['A 100', 'B 200'], ['B 200'])];
  const out = spreadHardOutcome(planOf(same), planOf(same));
  if (out.adopt && /changed nothing/.test(out.note) && !/are spread one to a term/.test(out.note)) ok('a plan nothing moved in is not called spread');
  else fail(`identical: ${JSON.stringify(out)}`);
}
{
  // The Economics shape: spread everywhere but the last term.
  const base = planOf([term('Spring 2028', ['ECON 202', 'ECON 302'], ['ECON 202', 'ECON 302']), term('Spring 2030', ['ECON 472'], [])]);
  const spread = planOf([term('Spring 2028', ['ECON 202'], ['ECON 202']), term('Spring 2030', ['ECON 302', 'MATH 441', 'MATH 446'], ['MATH 441', 'MATH 446'])]);
  const out = spreadHardOutcome(base, spread);
  if (out.adopt && /except/.test(out.note) && /Spring 2030 \(MATH 441, MATH 446\)/.test(out.note) && !OLD_FALSE.test(out.note)) ok('an adopted plan that still stacks a term says which one');
  else fail(`stacked but adopted: ${JSON.stringify(out)}`);
}
{
  // Only the hardest band is counted: a term heavy on the band below is named.
  const heavy = term('Spring 2028', ['MATH 220', 'MCB 354', 'PHYS 102'], ['MATH 220'], { bandVerdict: 'heavy', avgDifficulty: 43 });
  const d = { 'MATH 220': 64, 'MCB 354': 33, 'PHYS 102': 31 };
  const out = spreadHardOutcome(planOf([heavy]), planOf([heavy]), { difficulty: (c) => d[c] ?? null, bands: { typical: 10, harder: 28, hardest: 39 } });
  if (/Spring 2028 still reads heavy: MATH 220 sits with MCB 354 and PHYS 102/.test(out.note)) ok('a term heavy on the band below the hardest is named');
  else fail(`harder band: ${out.note}`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. spread_hard on real freshman plans ===\n');

const read = (n) => (existsSync(join(PUBLIC, n)) ? JSON.parse(readFileSync(join(PUBLIC, n), 'utf8')) : null);
const data = buildIllinoisData({ catalog: read('illinois-catalog.json'), programs: read('illinois-programs.json'), grades: read('illinois-grades.json'), sections: read('illinois-sections.json') });
const prereqs = new Map();
const creditRanges = new Map();
for (const [code, fact] of data.facts) { if (fact.prereq) prereqs.set(code, fact.prereq); creditRanges.set(code, fact.creditRange); }
const normCode = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();
const offeringsFile = read('illinois/offerings.json');
if (offeringsFile) applyOfferings(data.courses, offeringsFile);
const season = (data.sectionTerm?.term ?? 'fall').toLowerCase();
const context = {
  courses: data.courses, prereqs, grades: data.grades, sections: data.sections, equivalents: data.equivalents,
  exclusions: new Map(Object.entries(read('illinois/exclusions.json') ?? {})),
  creditRanges, bands: data.bands,
  offeringPublished: offeringsFile ? new Set(data.courses.map((c) => normCode(c.code))) : new Set(),
  offerings: offeringsFile ? new Map(Object.entries(offeringsFile.courses)) : undefined, offeringTerms: offeringsFile ? offeringsFile.terms : undefined,
  offeringAliases: offeringsFile?.renumbered ? new Map(Object.entries(offeringsFile.renumbered)) : undefined,
  languages: read('illinois/languages.json') ?? undefined,
  snapshotTerm: data.sectionTerm ? { id: data.sectionTerm.id, label: data.sectionTerm.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  gradeFootnote: gradeFootnote(data.gradeProvenance),
  prereqCheck: (spec, earlier, sameTerm, equivalents) => missingPrerequisiteGroups(spec ?? null, earlier, sameTerm, equivalents),
};
const byId = new Map(data.programs.map((p) => [p.id, p]));
const NO_PRIOR = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true };
const FOUR_YEARS = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030 };
const planFor = (id, prefs = {}, horizon = FOUR_YEARS) => {
  const program = byId.get(id);
  return generatePlan({
    requirements: data.requirementBlocks.get(id) ?? [], context, prior: NO_PRIOR, horizon, programId: id,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, ...prefs },
    degreeTotal: program.totalCredits ?? null, programName: program.name, programCollege: program.college,
  });
};
const termOf = (plan, code) => plan.terms.findIndex((t) => t.codes.includes(code));

for (const [name, id] of [['Mechanical Engineering freshman', 'engineering/mechanical-engineering-bs'], ['Molecular and Cellular Biology freshman', 'las/molecular-cellular-biology-bslas']]) {
  if (!byId.has(id)) { console.log(`  (${id} is not in this crawl)`); continue; }
  const base = planFor(id);
  const spread = planFor(id, { maxHardCourses: 1 });
  const out = spreadHardOutcome(base, spread, { difficulty: (c) => context.grades.get(c)?.difficulty ?? null, bands: context.bands });
  const kept = out.adopt ? spread : base;
  console.log(`  ${name}: ${out.adopt ? 'kept' : 'turned down'}. ${out.note}`);
  // College Algebra never lands after the calculus it sits below.
  const m112 = termOf(spread, 'MATH 112');
  const after = ['MATH 220', 'MATH 221', 'MATH 231'].filter((c) => m112 >= 0 && termOf(spread, c) >= 0 && termOf(spread, c) < m112);
  if (after.length === 0) ok(`${name}: the spread plan keeps MATH 112 no later than ${['MATH 220', 'MATH 221', 'MATH 231'].filter((c) => termOf(spread, c) >= 0).join(' and ') || 'calculus'}`);
  else fail(`${name}: the spread plan puts MATH 112 after ${after.join(', ')}`);
  // Deferring a hard course never makes a term harder than the plan it replaces.
  const hardest = (g) => Math.max(0, ...g.terms.map((t) => t.load.hard.length));
  const worse = spread.terms.slice(0, -1).filter((t) => t.load.hard.length > Math.max(1, hardest(base)));
  if (worse.length === 0) ok(`${name}: no term of the spread plan holds more hardest-band courses than the ordinary plan's hardest`);
  else fail(`${name}: ${worse.map((t) => `${t.label} (${t.load.hard.join(', ')})`).join('; ')} came out harder`);
  // The note says what the kept plan does.
  const stacked = kept.terms.filter((t) => t.load.hard.length >= 2);
  const identical = JSON.stringify(base.terms.map((t) => t.codes)) === JSON.stringify(spread.terms.map((t) => t.codes));
  if (OLD_FALSE.test(out.note)) fail(`${name}: the note repeats a claim the board does not support: ${out.note}`);
  else if (!out.adopt && !/put \d+ hardest-band courses in|add \d+ terms?|leave \d+ more/.test(out.note)) fail(`${name}: turned down without naming the check: ${out.note}`);
  else if (out.adopt && stacked.some((t) => !out.note.includes(t.label))) fail(`${name}: a stacked term is missing from the note: ${out.note}`);
  else if (out.adopt && stacked.length === 0 && !identical && !/one to a term/.test(out.note)) fail(`${name}: a spread plan with no stacked term does not say so: ${out.note}`);
  else if (out.adopt && identical && !/changed nothing/.test(out.note)) fail(`${name}: nothing moved and the note does not say so: ${out.note}`);
  else ok(`${name}: the note matches the board it describes`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. Credits beyond the degree: the cause the note names ===\n');
{
  /** One case: what it shows, the hours, the note it must give, and words it must not use. */
  const expect = (what, input, want, never) => {
    const note = describeBeyondTotal(input);
    if (note && want.test(note) && !(never && never.test(note))) ok(`${what}: ${note}`);
    else fail(`${what}: ${String(note)}`);
  };
  expect('the top-up to the minimum', { degreeTotal: 128, total: 132, booked: 128, prior: 0, padded: 4, track: 0, minimum: 12 }, /^4 credits beyond the 128 this degree takes keep every term at the 12 you set as a minimum\./, null);
  // Maya: Computer Engineering and 41 AP hours come to 130 before any elective.
  expect('required courses with credit in hand', { degreeTotal: 128, total: 130, booked: 130, prior: 41, padded: 0, track: 0, minimum: 12 }, /^The required courses round this plan up to 2 credits beyond the 128 this degree takes: .*with the 41 hours you bring, already comes to 130/, /minimum/);
  // Part-time Economics at 9 a term: the elective that crossed 120 carried 4 credits where 2 were left.
  expect('a last elective bigger than the hours left', { degreeTotal: 120, total: 122, booked: 72, prior: 0, padded: 0, track: 0, minimum: 6 }, /^Course sizes round this plan up to 2 credits beyond the 120/, /minimum/);
  expect('several causes, each with its share', { degreeTotal: 120, total: 125, booked: 121, prior: 0, padded: 2, track: 0, minimum: 12 }, /^5 credits beyond the 120 this degree takes: 2 keep every term at the 12 you set as a minimum; 1 comes from the required courses.*; 2 come from course sizes/, null);
  if (describeBeyondTotal({ degreeTotal: 120, total: 120, booked: 100, prior: 0, padded: 0, track: 0, minimum: 12 }) === null) ok('a plan at its total says nothing');
  else fail('a plan at its total still explained a surplus');
}
{
  // A real part-time plan: 6 a term at least, 9 aimed at, finishing Spring 2034.
  const id = 'las/economics-balas';
  if (byId.has(id)) {
    const plan = planFor(id, { creditsPerTerm: { min: 6, target: 9, max: 18 } }, { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2034, stated: true });
    const used = plan.terms.filter((t) => t.codes.length > 0 && t.season !== 'Summer');
    const note = plan.notes.find((n) => /beyond the \d+ this degree takes/.test(n)) ?? null;
    const atMinimum = used.some((t) => t.credits.min <= 6 + 4);
    console.log(`  Economics part-time: terms [${used.map((t) => t.credits.min).join(',')}]`);
    if (note === null) ok('Economics part-time: no surplus, no note');
    else if (/at the 6 you set as a minimum/.test(note) && !atMinimum) fail(`Economics part-time names the minimum while no term is near it: ${note}`);
    else ok(`Economics part-time: ${note}`);
  }
}

console.log(`\n${failures === 0 ? 'ALL PLAN NOTE CHECKS PASSED' : `${failures} PLAN NOTE CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
