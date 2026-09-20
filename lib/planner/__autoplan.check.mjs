/**
 * Runs the product's own planning path over the real Illinois files and prints
 * what it could and could not do.
 *
 * Run it with:  PATH="/opt/homebrew/opt/node@23/bin:$PATH" node lib/planner/__autoplan.check.mjs
 * It re-execs itself with the type-stripping flag, so no build step is needed.
 *
 * THERE IS NO ADAPTER IN THIS FILE ANY MORE, and that is the point of it.
 *
 * It used to carry its own copy of the catalog adapter, the prerequisite
 * grammar and a general education synthesiser, and the last of those is what
 * made this harness worse than useless. The real module planned zero gen-ed
 * credit for all 227 degrees that have a gen-ed table; the copy in here planned
 * it, so this harness reported Computer Science at 118 of 128 while the running
 * app showed 88. A harness that flatters the product is a harness that hides
 * the defect it exists to find.
 *
 * So the chain below is exactly the chain illinois-source.tsx assembles in the
 * browser: buildIllinoisData -> requirementBlocks -> generatePlan. If a number
 * here is wrong, it is wrong in the product too.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');

// Node 23.3 keeps type stripping behind a flag, so re-exec once with it on.
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

// The repo imports without extensions, which node cannot resolve on its own.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

const { generatePlan, validatePlan, describeCreditTotal, describeCreditProgress } =
  await import('./autoplan.ts');
const { buildIllinoisData, gradeFootnote, missingPrerequisiteGroups, GENED_CAMPUS_SOURCE } =
  await import('./illinois-data.ts');

const read = (name) => {
  const path = join(PUBLIC, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
};

const catalogFile = read('illinois-catalog.json');
const programFile = read('illinois-programs.json');

if (!catalogFile) {
  console.error('public/illinois-catalog.json is missing. The crawl has not produced it yet.');
  process.exit(1);
}

const data = buildIllinoisData({
  catalog: catalogFile,
  programs: programFile,
  grades: read('illinois-grades.json'),
  sections: read('illinois-sections.json'),
});

/**
 * The planning context, assembled the way illinois-source.tsx assembles it.
 *
 * The three maps are pulled out of CourseFacts rather than rebuilt, because
 * CourseFacts is what the browser's own second load carries and any second
 * reading of the catalog here is the divergence this file just got rid of.
 */
const prereqs = new Map();
const creditRanges = new Map();
const exclusions = new Map();
for (const [code, fact] of data.facts) {
  if (fact.prereq) prereqs.set(code, fact.prereq);
  creditRanges.set(code, fact.creditRange);
  if (fact.exclusions.length > 0) exclusions.set(code, fact.exclusions);
}

const season = (data.sectionTerm?.term ?? 'fall').toLowerCase();
const context = {
  courses: data.courses,
  prereqs,
  grades: data.grades,
  sections: data.sections,
  equivalents: data.equivalents,
  exclusions,
  creditRanges,
  bands: data.bands,
  // Illinois publishes no offering term anywhere, so no course is ever refused
  // a term for being "spring only".
  offeringPublished: new Set(),
  snapshotTerm: data.sectionTerm
    ? {
        id: data.sectionTerm.id,
        label: data.sectionTerm.label,
        season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall',
      }
    : null,
  gradeFootnote: gradeFootnote(data.gradeProvenance),
  prereqCheck: (spec, earlier, sameTerm, equivalents) =>
    missingPrerequisiteGroups(spec ?? null, earlier, sameTerm, equivalents),
};

const programById = new Map(data.programs.map((p) => [p.id, p]));

// --- a few of the golden prerequisite cases, from the real parser -----------
const GOLDEN = [
  ['AE 321', '[MATH 285] AND [TAM 210|TAM 211]'],
  ['CS 225', '[CS 126|CS 128|ECE 220] AND [CS 173|CS 413|MATH 213|MATH 314|MATH 412|MATH 413]'],
  ['ABE 455', '[CEE 350|NRES 401] AND [CEE 380|NRES 201]'],
  ['ACCY 201', 'two groups, self dropped, second concurrent'],
  ['ANTH 352', 'zero groups'],
  ['CHEM 360', "confidence 'low'"],
  ['CEE 202', '[CS 101|CS 124] AND [MATH 241]~conc'],
  ['CS 498', 'zero groups, and a prerequisite NOTE the catalog states in prose'],
  ['CS 492', 'zero groups, senior standing'],
  ['CS 497', 'zero groups, junior standing'],
];
console.log('PREREQUISITE PARSER SPOT CHECK (the real module, illinois-data.ts)');
for (const [code, expected] of GOLDEN) {
  const spec = prereqs.get(code);
  const shown = spec && spec.groups.length
    ? spec.groups.map((g) => `[${g.any.join('|')}]${g.concurrent ? '~conc' : ''}${g.confidence === 'low' ? '?' : ''}`).join(' AND ')
    : 'zero groups';
  const extra = [
    spec?.escape ? `escape=${spec.escape}` : null,
    spec?.standing ? `standing=${spec.standing}` : null,
    spec?.note ? `note="${spec.note}"` : null,
  ].filter(Boolean).join('  ');
  console.log(`  ${code.padEnd(9)} ${shown}${extra ? `   ${extra}` : ''}`);
  console.log(`  ${''.padEnd(9)} expected: ${expected}`);
}

const coverage = data.coverage;
console.log('');
console.log('CATALOG, as buildIllinoisData reads it');
console.log(`  ${coverage.catalogCourses} rows, ${coverage.undergraduateCourses} undergraduate and non-noise`);
console.log(`  ${coverage.variableCredit} variable credit, ${coverage.unknownCredit} with no credit hours listed`);
console.log(`  ${coverage.withParsedPrereq} parsed prerequisites, ${coverage.withLowConfidencePrereq} of those low confidence`);
console.log(`  ${coverage.withPrereqTextOnly} with a sentence the parser could not read, ${coverage.withPrereqNoteOnly} with a prose note and no clause at all`);
console.log(`  ${coverage.withStandingRequirement} state a class standing the student must have`);
console.log(`  ${data.equivalents.size} cross-listed codes, ${exclusions.size} with an exclusion clause`);
console.log(`  grades: ${data.grades.size} rows, bands typical=${data.bands.typical} harder=${data.bands.harder} hardest=${data.bands.hardest}`);
console.log(`  sections: ${data.sectionTerm ? `${data.sections.size} courses in ${data.sectionTerm.label}` : 'not loaded'}`);
console.log('');
console.log('GENERAL EDUCATION');
console.log(`  ${coverage.programsWithGenEd} of ${coverage.programs} programs carry a campus gen-ed table, ${coverage.genEdCategories} categories in total`);
console.log(`  ${coverage.genEdCategoriesFromCampus} of those categories are sized from the campus table rather than a degree page`);
console.log(`  ${GENED_CAMPUS_SOURCE}`);


// --- programs to run -------------------------------------------------------
const WANTED = [
  'engineering/computer-science-bs',
  'engineering/civil-engineering-bs',
  'las/chemical-engineering-bs',
  'engineering/aerospace-engineering-bs',
  'ahs/community-health-bs/health-education-promotion',
  'las/psychology-bslas',
  'aces/agricultural-consumer-economics-bs',
];

if (!programFile) {
  console.error('\npublic/illinois-programs.json is missing, so no program could be planned.');
  process.exit(1);
}
const programs = WANTED.map((id) => programById.get(id)).filter(Boolean);
// A named degree that is not in this crawl must not quietly shrink the run, so
// the list is topped up from the biggest pages the file does have.
const extra = [...programById.values()]
  .filter((p) => !WANTED.includes(p.id) && (data.requirementBlocks.get(p.id)?.length ?? 0) > 10)
  .sort((a, b) => (data.requirementBlocks.get(b.id)?.length ?? 0) - (data.requirementBlocks.get(a.id)?.length ?? 0));
while (programs.length < 7 && extra.length) programs.push(extra.shift());

const HORIZON = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030 };
const NO_PRIOR = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true };

let totalPrereqErrors = 0;
let totalStandingErrors = 0;

/** How many blocks of each kind a degree page produced, for the run header. */
function countKinds(blocks) {
  const counts = { all: 0, choose: 0, hours: 0, pool: 0, gened: 0, unparsed: 0, constraints: 0 };
  for (const b of blocks) {
    counts[b.rule.kind] += 1;
    if (b.rule.kind === 'pool') counts.constraints += b.rule.constraints.length;
  }
  return counts;
}

for (const program of programs) {
  const blocks = data.requirementBlocks.get(program.id) ?? [];
  const counts = countKinds(blocks);
  const result = generatePlan({
    requirements: blocks,
    context,
    prior: NO_PRIOR,
    horizon: HORIZON,
    programId: program.id,
    preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 } },
  });

  console.log('\n' + '='.repeat(78));
  console.log(`${program.name}  [${program.degree || 'no degree code'}]`);
  console.log(`  requirement blocks: ${blocks.length}  (all ${counts.all}, choose ${counts.choose}, hours ${counts.hours}, pool ${counts.pool}, gen ed ${counts.gened}, unparsed ${counts.unparsed}; ${counts.constraints} nested pool constraints)`);

  const used = result.terms.filter((t) => t.codes.length > 0);
  console.log(`  terms used: ${used.length} of ${result.terms.length}`);
  // The published degree total, not the sum of these blocks. They are different
  // numbers whenever a page leaves a credit cell empty, and the one a student
  // is owed is the one printed on the catalog page.
  console.log(`  HEADLINE: ${describeCreditProgress(result.credits, program.totalCredits)}`);
  console.log(`  planned credits: ${describeCreditTotal(result.credits.planned)}`);
  console.log(`  catalog degree hours from these blocks: ${result.credits.degreeTotal ?? 'not listed'}   unaccounted: ${result.credits.unaccounted ?? 'n/a'}`);
  for (const b of blocks) {
    if (b.rule.kind !== 'gened') continue;
    const want = [
      b.rule.hours !== null ? `${b.rule.hours} hours` : null,
      b.rule.courses !== null ? `${b.rule.courses} course${b.rule.courses === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' and ');
    console.log(
      `    gen ed: ${b.label.padEnd(46)} wants ${want.padEnd(12)} ${b.rule.sizeFromCampus ? 'campus table' : 'this page  '}` +
        `  the page says it is fulfilled by: ${b.rule.fulfilledBy.map((o) => o.join(' or ')).join(', ') || 'nothing'}`,
    );
  }

  for (const term of result.terms) {
    if (term.codes.length === 0) {
      console.log(`    ${term.label.padEnd(12)} empty`);
      continue;
    }
    const load = term.load;
    console.log(
      `    ${term.label.padEnd(12)} ${String(term.codes.length).padStart(2)} courses  ` +
        `${describeCreditTotal(term.credits).padEnd(11)}  ` +
        `band=${load.bandVerdict.padEnd(6)} (scheduler says ${load.verdict.padEnd(6)}) avg=${String(load.avgDifficulty ?? '--').padStart(2)}  ` +
        `weighed ${load.weighed}/${term.codes.length}  hardest-band ${load.hard.length}`,
    );
    console.log(`                 ${term.codes.join(', ')}`);
    for (const note of term.notes) console.log(`                 note: ${note}`);
  }

  // Independent re-check: run the hand-edit validator over the generated plan.
  // Anything the generator placed illegally shows up here as an error.
  const issues = validatePlan(result.plan, context, { minimumTermCredits: 12, maxTermCredits: 18 });
  const prereqErrors = issues.filter((i) => i.severity === 'error' && i.id.startsWith('ap-prereq-'));
  totalPrereqErrors += prereqErrors.length;
  console.log(`  prerequisite violations in the generated plan: ${prereqErrors.length}`);
  for (const issue of prereqErrors.slice(0, 5)) console.log(`     ${issue.message}`);

  // Class standing, checked independently of the placer that just honoured it.
  const standingErrors = issues.filter((i) => i.id.startsWith('ap-standing-'));
  totalStandingErrors += standingErrors.length;
  const standingCourses = result.plan.terms.flatMap((t, ti) =>
    t.courseIds
      .map((id) => context.courses.find((c) => c.id === id))
      .filter((c) => c && prereqs.get(c.code)?.standing)
      .map((c) => `${c.code} (${prereqs.get(c.code).standing}, term ${ti + 1})`),
  );
  console.log(`  class standing violations in the generated plan: ${standingErrors.length}`);
  if (standingCourses.length > 0) {
    console.log(`  courses placed that require a class standing: ${standingCourses.join(', ')}`);
  }
  const notPlacedStanding = result.notPlaced.filter((n) => n.reason === 'standing-unmet');
  for (const n of notPlacedStanding.slice(0, 4)) console.log(`     [standing] ${n.message.slice(0, 190)}`);

  const byKind = {};
  for (const issue of issues) {
    const key = `${issue.severity}/${issue.title}`;
    byKind[key] = (byKind[key] ?? 0) + 1;
  }
  console.log('  validatePlan issues: ' + (Object.keys(byKind).length ? Object.entries(byKind).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k} x${v}`).join(', ') : 'none'));

  for (const pool of result.pools) {
    const want = [
      pool.hoursTarget !== null ? `${pool.hoursTarget} hours` : null,
      pool.countTarget !== null ? `${pool.countTarget} courses` : null,
    ].filter(Boolean).join(' and ');
    console.log(
      `  pool: ${pool.areaLabel} / ${pool.label} -- wants ${want || 'an unstated amount'}; ` +
        `plan has ${pool.hours} hours in ${pool.count} courses; ` +
        `${pool.available} of ${pool.listed} listed courses in the snapshot; ${pool.alternatives.length} not taken`,
    );
    if (pool.picked.length) console.log(`        took: ${pool.picked.join(', ')}`);
    if (pool.fromPriorCredit.length) console.log(`        already had: ${pool.fromPriorCredit.join(', ')}`);
    for (const c of pool.constraints) {
      console.log(`        [${c.met ? 'met' : 'NOT MET'}] needs ${c.n}${c.from ? ` from "${c.from}"` : ''}, has ${c.picked.length}: ${c.picked.join(', ') || 'nothing'}`);
      console.log(`                catalog: ${c.text.slice(0, 120)}`);
    }
  }

  console.log(`  unsatisfied requirements: ${result.unsatisfied.length}`);
  for (const u of result.unsatisfied.slice(0, 6)) {
    console.log(`     [${u.reason}] ${u.areaLabel} / ${u.label}: ${u.message.slice(0, 130)}`);
  }
  if (result.unsatisfied.length > 6) console.log(`     ... and ${result.unsatisfied.length - 6} more`);

  console.log(`  courses that could not be placed: ${result.notPlaced.length}`);
  for (const n of result.notPlaced.slice(0, 6)) console.log(`     [${n.reason}] ${n.message}`);
  if (result.notPlaced.length > 6) console.log(`     ... and ${result.notPlaced.length - 6} more`);

  if (result.satisfiedByPriorCredit.length) {
    console.log(`  already satisfied by prior credit: ${result.satisfiedByPriorCredit.length} requirements`);
  }
  if (result.offering.message) console.log(`  offering: ${result.offering.message}`);
  for (const line of result.partsOfTerm.slice(0, 3)) console.log(`  parts of term: ${line}`);
  for (const note of result.notes) console.log(`  note: ${note}`);
}

// --- the transfer case, which is the whole reason PriorCredit exists --------
const transferProgram = programs[0];
if (transferProgram) {
  const blocks = data.requirementBlocks.get(transferProgram.id) ?? [];
  const transfer = {
    courseCodes: ['MATH 221', 'MATH 231', 'CS 124', 'RHET 105', 'PHYS 211'],
    exemptCodes: ['CHEM 102'],
    unmatchedCredits: 12,
    known: true,
  };
  const result = generatePlan({
    requirements: blocks,
    context,
    prior: transfer,
    horizon: { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2029 },
    programId: transferProgram.id,
  });
  console.log('\n' + '='.repeat(78));
  console.log(`TRANSFER CASE: ${transferProgram.name}, 5 courses in hand, 12 unmatched hours, graduating a year earlier`);
  console.log(`  terms used: ${result.terms.filter((t) => t.codes.length).length} of ${result.terms.length}`);
  console.log(`  HEADLINE: ${describeCreditProgress(result.credits, transferProgram.totalCredits)}`);
  console.log(`  prior credits counted: ${result.credits.prior}`);
  console.log(`  planned credits: ${describeCreditTotal(result.credits.planned)}`);
  console.log(`  planned plus already held: ${describeCreditTotal(result.credits.total)}`);
  console.log(`  requirements already satisfied by prior credit: ${result.satisfiedByPriorCredit.length}`);
  for (const s of result.satisfiedByPriorCredit.slice(0, 6)) console.log(`     ${s.label || '(unlabelled group)'}: ${s.codes.join(', ')}`);
  const issues = validatePlan(result.plan, context, {});
  const prereqErrors = issues.filter((i) => i.severity === 'error' && i.id.startsWith('ap-prereq-'));
  totalPrereqErrors += prereqErrors.length;
  console.log(`  prerequisite violations: ${prereqErrors.length}`);
  console.log(`  could not place: ${result.notPlaced.length}`);
  for (const n of result.notPlaced.slice(0, 4)) console.log(`     [${n.reason}] ${n.message}`);
  for (const note of result.notes) console.log(`  note: ${note}`);
}

// --- the unknown-transcript case ------------------------------------------
if (transferProgram) {
  const blocks = data.requirementBlocks.get(transferProgram.id) ?? [];
  const result = generatePlan({
    requirements: blocks,
    context,
    prior: { courseCodes: [], exemptCodes: [], unmatchedCredits: 30, known: false },
    horizon: HORIZON,
    programId: transferProgram.id,
  });
  console.log('\n' + '='.repeat(78));
  console.log('UNKNOWN TRANSCRIPT CASE: student says they transferred, did not say what they took');
  for (const note of result.notes) console.log(`  note: ${note}`);
}

// --- degraded mode: prerequisites not loaded -------------------------------
if (transferProgram) {
  const blocks = data.requirementBlocks.get(transferProgram.id) ?? [];
  const degraded = { ...context, prereqs: undefined };
  const result = generatePlan({ requirements: blocks, context: degraded, prior: NO_PRIOR, horizon: HORIZON, programId: transferProgram.id });
  const issues = validatePlan(result.plan, degraded, {});
  console.log('\n' + '='.repeat(78));
  console.log('DEGRADED MODE: prerequisites never loaded');
  console.log(`  terms used: ${result.terms.filter((t) => t.codes.length).length}`);
  for (const note of result.notes) console.log(`  note: ${note}`);
  const unchecked = issues.find((i) => i.id === 'ap-prereqs-unloaded');
  console.log(`  validatePlan says: ${unchecked ? unchecked.message : 'NOTHING, which would be a bug'}`);
}

console.log('\n' + '='.repeat(78));
console.log(`TOTAL PREREQUISITE VIOLATIONS ACROSS EVERY GENERATED PLAN: ${totalPrereqErrors}`);
console.log(`TOTAL CLASS STANDING VIOLATIONS ACROSS EVERY GENERATED PLAN: ${totalStandingErrors}`);
process.exit(totalPrereqErrors === 0 ? 0 : 1);
