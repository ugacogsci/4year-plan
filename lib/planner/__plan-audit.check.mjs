/**
 * The product path, audited. Not the adapter path.
 *
 * This file exists because a test harness has twice measured something the
 * product does not do, and reported it as a result:
 *
 *   1. __autoplan.check.mjs synthesised general-education blocks that the real
 *      module did not build, and reported "118 of 128 planned credits" while
 *      the running app showed 88.
 *   2. The measurement script this one grew from read course exclusions out of
 *      the FULL catalog adapter. The browser never loads that before it builds
 *      a plan, so the audit passed while the product handed a student MATH 221
 *      on top of the MATH 220 they already had, and counted both.
 *
 * So everything here is loaded the way the browser loads it: from the built
 * artifacts in public/illinois, not from the raw crawl and not from an adapter
 * the first paint never sees.
 *
 * It exits non-zero on any exclusion violation, which is a plan telling a
 * student to take a course whose credit will not count.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = '/Users/michaelcrews/THE ADVISOR/planner/lib/planner';
const PUBLIC = '/Users/michaelcrews/THE ADVISOR/planner/public';

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
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

const { generatePlan, validatePlan, describeCreditTotal, describeCreditProgress } = await import(join(HERE, 'autoplan.ts'));
const { buildIllinoisData, gradeFootnote, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { areaProgress } = await import(join(HERE, 'scheduler.ts'));

const read = (n) => (existsSync(join(PUBLIC, n)) ? JSON.parse(readFileSync(join(PUBLIC, n), 'utf8')) : null);
const data = buildIllinoisData({
  catalog: read('illinois-catalog.json'),
  programs: read('illinois-programs.json'),
  grades: read('illinois-grades.json'),
  sections: read('illinois-sections.json'),
});

const prereqs = new Map();
const creditRanges = new Map();
// The product loads public/illinois/exclusions.json, not the full adapter. Using
// the adapter here is exactly why the harness never saw the MATH 220/221 bug.
const shipped = JSON.parse(readFileSync(PUBLIC + '/illinois/exclusions.json', 'utf8'));
const exclusions = new Map(Object.entries(shipped));
const _unusedExclusions = new Map();
for (const [code, fact] of data.facts) {
  if (fact.prereq) prereqs.set(code, fact.prereq);
  creditRanges.set(code, fact.creditRange);
  if (fact.exclusions.length > 0) _unusedExclusions.set(code, fact.exclusions);
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
  offeringPublished: new Set(),
  snapshotTerm: data.sectionTerm
    ? { id: data.sectionTerm.id, label: data.sectionTerm.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' }
    : null,
  gradeFootnote: gradeFootnote(data.gradeProvenance),
  prereqCheck: (spec, earlier, sameTerm, equivalents) => missingPrerequisiteGroups(spec ?? null, earlier, sameTerm, equivalents),
};

const byId = new Map(data.programs.map((p) => [p.id, p]));
const WANTED = [
  'engineering/computer-science-bs',
  'engineering/civil-engineering-bs',
  'las/chemical-engineering-bs',
  'engineering/aerospace-engineering-bs',
  'ahs/community-health-bs/health-education-promotion',
  'las/psychology-bslas',
  'aces/agricultural-consumer-economics-bs',
];
const HORIZON = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030 };
const NO_PRIOR = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true };
const normCode = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();

const GENERATED = [];
let prereqErrors = 0;
let standingErrors = 0;

function run(program, prior, horizon, tag) {
  const blocks = data.requirementBlocks.get(program.id) ?? [];
  const result = generatePlan({
    requirements: blocks,
    context,
    prior,
    horizon,
    programId: program.id,
    preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 } },
  });
  const have = new Set(prior.courseCodes.map(normCode));
  for (const term of result.terms) for (const c of term.codes) have.add(normCode(c));
  GENERATED.push([`${program.name}${tag ? ' ' + tag : ''}`, [...have]]);
  const progress = areaProgress(program, have);

  console.log('='.repeat(78));
  console.log(`${program.name}  [${program.degree}]${tag ? `  ${tag}` : ''}`);
  console.log(`  planned credits: ${describeCreditTotal(result.credits.planned)}`);
  console.log(`  HEADLINE: ${describeCreditProgress(result.credits, program.totalCredits)}`);
  console.log(`  terms in plan.terms: ${result.plan.terms.length}, last = ${result.plan.terms[result.plan.terms.length - 1].label}, holding ${result.plan.terms[result.plan.terms.length - 1].courseIds.length}`);
  for (const p of progress) {
    const shown = p.area.hours ? `${p.earned}/${p.area.hours}` : `${p.earned} hr`;
    console.log(`    area  ${(p.area.label ?? '(unnamed)').padEnd(46)} ${shown.padEnd(10)} groups ${p.area.groups.length}`);
  }
  for (const t of result.terms) {
    console.log(`    ${t.label.padEnd(12)} ${describeCreditTotal(t.credits).padEnd(12)} ${t.codes.join(', ') || 'empty'}`);
  }
  for (const c of result.priorLearning) console.log(`    prior learning [${c.settled}] ${c.message}`);
  const issues = validatePlan(result.plan, context, { minimumTermCredits: 12, maxTermCredits: 18 });
  const pe = issues.filter((i) => i.severity === 'error' && i.id.startsWith('ap-prereq-'));
  const se = issues.filter((i) => i.id.startsWith('ap-standing-'));
  prereqErrors += pe.length;
  standingErrors += se.length;
  console.log(`  prerequisite violations: ${pe.length}   class standing violations: ${se.length}`);
  for (const i of pe.slice(0, 4)) console.log(`     ${i.message}`);
  return result;
}

for (const id of WANTED) {
  const p = byId.get(id);
  if (!p) { console.log(`MISSING PROGRAM ${id}`); continue; }
  run(p, NO_PRIOR, HORIZON, '');
}

// The AP Calculus BC student the review named: MATH 220 and MATH 231 in hand.
const cs = byId.get('engineering/computer-science-bs');
run(cs, { courseCodes: ['MATH 220', 'MATH 231'], exemptCodes: [], unmatchedCredits: 0, known: true }, HORIZON, '(AP Calculus BC: MATH 220 + MATH 231)');
// The AP Calculus BC score 3 student, who holds MATH 234. MATH 234 lists MATH 112.
run(cs, { courseCodes: ['MATH 234'], exemptCodes: [], unmatchedCredits: 0, known: true }, HORIZON, '(AP Calculus BC score 3: MATH 234)');

console.log('='.repeat(78));
console.log(`TOTAL PREREQUISITE VIOLATIONS: ${prereqErrors}`);
console.log(`TOTAL CLASS STANDING VIOLATIONS: ${standingErrors}`);

// ---- exclusion audit over every plan generated above, prior credit included ----
{
  const ex = new Map(Object.entries(JSON.parse(readFileSync(PUBLIC + '/illinois/exclusions.json', 'utf8'))));
  const n = (c) => String(c).toUpperCase().replace(/\s+/g, ' ').trim();
  let bad = 0;
  for (const [name, codes] of GENERATED) {
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        const a = n(codes[i]), b = n(codes[j]);
        if ((ex.get(a) || []).map(n).includes(b) || (ex.get(b) || []).map(n).includes(a)) {
          console.log(`  VIOLATION  ${name}: ${a} + ${b}`);
          bad++;
        }
      }
    }
  }
  console.log(bad ? `*** ${bad} exclusion violations ***` : 'exclusion violations across every generated plan: 0');
  if (bad) process.exitCode = 1;
}
