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

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');

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
const excellentFile = existsSync(join(PUBLIC, 'illinois', 'excellent.json')) ? JSON.parse(readFileSync(join(PUBLIC, 'illinois', 'excellent.json'), 'utf8')) : null;
const _unusedExclusions = new Map();
for (const [code, fact] of data.facts) {
  if (fact.prereq) prereqs.set(code, fact.prereq);
  creditRanges.set(code, fact.creditRange);
  if (fact.exclusions.length > 0) _unusedExclusions.set(code, fact.exclusions);
}
const season = (data.sectionTerm?.term ?? 'fall').toLowerCase();
const normCode = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();
const offeringsFile = existsSync(join(PUBLIC, 'illinois', 'offerings.json')) ? JSON.parse(readFileSync(join(PUBLIC, 'illinois', 'offerings.json'), 'utf8')) : null;
if (offeringsFile) { const { applyOfferings } = await import(new URL('./illinois-load.ts', import.meta.url).href); applyOfferings(data.courses, offeringsFile); }
const languagesFile = existsSync(join(PUBLIC, 'illinois', 'languages.json')) ? JSON.parse(readFileSync(join(PUBLIC, 'illinois', 'languages.json'), 'utf8')) : null;
const context = {
  courses: data.courses,
  prereqs,
  grades: data.grades,
  sections: data.sections,
  equivalents: data.equivalents,
  exclusions,
  excellent: excellentFile ? new Map(Object.entries(excellentFile.courses)) : undefined,
  excellentTerms: excellentFile ? excellentFile.terms : undefined,
  creditRanges,
  bands: data.bands,
  offeringPublished: offeringsFile ? new Set(data.courses.map((c) => normCode(c.code))) : new Set(),
  offerings: offeringsFile ? new Map(Object.entries(offeringsFile.courses)) : undefined,
  offeringTerms: offeringsFile ? offeringsFile.terms : undefined, offeringAliases: offeringsFile?.renumbered ? new Map(Object.entries(offeringsFile.renumbered)) : undefined,
  languages: languagesFile ?? undefined,
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

const GENERATED = [];
let prereqErrors = 0;
let standingErrors = 0;
let editFlags = 0;

function run(program, prior, horizon, tag, admissionRoute = null) {
  const blocks = data.requirementBlocks.get(program.id) ?? [];
  const result = generatePlan({
    requirements: blocks,
    context,
    prior,
    horizon,
    programId: program.id,
    preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 } },
    degreeTotal: program.totalCredits ?? null,
    programName: program.name, programCollege: program.college,
    admissionRoute,
  });
  const have = new Set(prior.courseCodes.map(normCode));
  for (const term of result.terms) for (const c of term.codes) have.add(normCode(c));
  // Held credit the plan itself forfeits to a required course is not counted
  // by the plan, and the plan says so. It is not a pair the student is being
  // told to take; it is a pair the student already has one half of.
  for (const f of result.forfeited) have.delete(normCode(f.held));
  for (const f of result.forfeited) console.log(`    forfeits ${f.held} to required ${f.for}`);
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
  // The rules a student's edits can break (Composition I in the first year;
  // in LAS and the iSchool a language course every term past 60 hours) are
  // ones the generated board must already keep.
  const edits = validatePlan(result.plan, context, { minimumTermCredits: 12, maxTermCredits: 18, programCollege: program.college, language: result.language }).filter((i) => /^ap-(comp1-late|language-gap)-/.test(i.id));
  editFlags += edits.length;
  for (const i of edits) console.log(`     EDIT FLAG ON A GENERATED BOARD: ${i.message}`);
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
// LAS and the iSchool with no language brought: the whole sequence is owed,
// and the board has to finish it before 60 hours or keep one every term.
const psych = byId.get('las/psychology-bslas');
if (psych) run(psych, { ...NO_PRIOR, languageSemesters: 0 }, HORIZON, '(no language brought)');
const info = byId.get('ischool/information-sciences-bs');
if (info) run(info, { ...NO_PRIOR, languageSemesters: 0 }, HORIZON, '(no language brought)');

// ---- the route into a college, chosen from how the student entered Illinois ----
//
// A Fall 2026 Psychology first-year who wants mechanical engineering was
// handed Grainger's transfer admission (3.00 GPA, Calculus III, PHYS 212,
// CHEM 104/105, opening January 15) by program_admission, and an ME board
// with the same words had MCB 150 forced into its first term. Her route is
// Engineering Undeclared: Calculus 1 and General Chemistry 1 by the semester
// she first applies in, 3.30 cumulative and 3.0 technical, May 1-15 of her
// second semester or November 15-30 of her third. A student coming from
// Parkland keeps the transfer admission and is told EU is not for them; a
// student aiming at Computer Science is told it is closed to on-campus
// transfer. The choice is the one the workspace makes (admission-route.ts),
// and the plans are built with the route it hands generatePlan.
{
  const { admissionGoal, chooseAdmission, describeAdmissionChoice, readEntry, goalFromQuery } = await import(join(HERE, 'admission-route.ts'));
  const table = JSON.parse(readFileSync(join(PUBLIC, 'illinois', 'admission.json'), 'utf8'));
  const START = { season: HORIZON.startSeason, year: HORIZON.startYear };
  let admissionProblems = 0;
  const expect = (ok, what) => { if (!ok) { admissionProblems++; console.log(`  *** ADMISSION: ${what}`); } };
  const choose = (program, words, record = null) => {
    const goal = admissionGoal(table, { college: program.college, programId: program.id, programName: program.name }, words, record);
    return goal ? chooseAdmission(table, goal, readEntry(words, record, START), START) : null;
  };
  const termIndexOf = (result, code) => result.terms.findIndex((t) => t.codes.map(normCode).includes(normCode(code)));
  const psych = byId.get('las/psychology-bslas');
  const me = byId.get('engineering/mechanical-engineering-bs');
  const computing = byId.get('engineering/computer-science-bs');

  // 1. The Psychology first-year: EU, its two courses by Spring 2027, nothing EU does not ask for.
  const firstYear = 'Psychology BSLAS, first-year starting fall 2026. I want to switch into mechanical engineering.';
  const eu = choose(psych, firstYear);
  console.log('='.repeat(78));
  console.log(`ADMISSION  Psychology first-year -> ME: ${eu ? `${eu.key}, front=${eu.front}, due by term ${eu.route?.dueTermIndex}` : 'no choice'}`);
  if (eu) console.log(`  ${describeAdmissionChoice(eu)}`);
  expect(eu?.key === 'engineering-undeclared' && eu.front, 'a first-year Psychology student who wants ME should get the Engineering Undeclared route, front-loaded');
  expect(eu?.route?.dueTermIndex === 1, 'EU courses should be due by term index 1 (Spring 2027, the second semester)');
  expect(/3\.30/.test(eu?.route?.eligibility.join(' ') ?? '') && /3\.0\b/.test(eu?.route?.eligibility.join(' ') ?? ''), 'EU eligibility should carry the 3.30 cumulative and 3.0 technical GPA');
  expect(eu?.windows[0]?.dates === 'May 1 – May 15, 2027' && eu?.windows[0]?.admits === 'Fall 2027', `first EU window should be May 1 – May 15, 2027 for Fall 2027, got ${eu?.windows[0]?.dates} for ${eu?.windows[0]?.admits}`);
  expect(eu?.windows[1]?.dates === 'November 15 – November 30, 2027', 'second EU window should be November 15 – November 30, 2027');
  expect(/Mechanical Engineering is one of the page's competitive majors/.test(eu?.competitive ?? ''), 'ME should be named as a competitive major with the two-competitive-majors limit');
  const onPsych = run(psych, NO_PRIOR, HORIZON, '(first-year aiming at ME: Engineering Undeclared)', eu?.front ? eu.route : null);
  const psychCodes = onPsych.terms.flatMap((t) => t.codes.map(normCode));
  const codes = (onPsych.admission?.codes ?? []).map(normCode);
  expect(codes.some((c) => c === 'MATH 220' || c === 'MATH 221') && codes.includes('CHEM 102') && codes.includes('CHEM 103'), `EU route courses should be Calculus 1 and CHEM 102 + 103, got ${codes.join(', ')}`);
  for (const c of codes) {
    const at = termIndexOf(onPsych, c);
    expect(at >= 0 && at <= 1, `${c} should be on the board by Spring 2027 (term 1), found at term ${at}`);
  }
  for (const c of ['MATH 241', 'PHYS 212', 'CHEM 104', 'MCB 150']) expect(!psychCodes.includes(c), `${c} is not an EU requirement and should not be forced onto a Psychology board`);

  // 2. The same student with Mechanical Engineering on the board: the route's due-by covers only EU's courses.
  const meFirstYear = "I'm a freshman in psychology and want to switch into mechanical engineering.";
  const euMe = choose(me, meFirstYear);
  const onMe = run(me, NO_PRIOR, HORIZON, '(first-year in LAS aiming at ME: Engineering Undeclared)', euMe?.front ? euMe.route : null);
  const meCodes = (onMe.admission?.codes ?? []).map(normCode);
  expect(euMe?.key === 'engineering-undeclared', 'an ME board for a first-year in LAS should take the EU route');
  for (const c of ['MATH 241', 'PHYS 212', 'CHEM 104', 'CHEM 105', 'MCB 150', 'MATH 231']) expect(!meCodes.includes(c), `${c} should not be an admission course on the ME board (it is Grainger's transfer admission list, not EU's)`);
  // MCB 150 may still appear later as ME's own science elective; what the route
  // must not do is book it for the application, in the first year.
  expect(termIndexOf(onMe, 'MCB 150') < 0 || termIndexOf(onMe, 'MCB 150') > 1, 'MCB 150 should not be booked in the first year of an ME board for EU');

  // 3. A student coming from Parkland: the transfer admission, and told EU is not for them.
  const transfer = choose(psych, "I'm finishing my associate's at Parkland and transferring to Illinois in fall 2027. I want to get into mechanical engineering.");
  console.log(`ADMISSION  Parkland transfer -> ME: ${transfer ? `${transfer.key}, front=${transfer.front}` : 'no choice'}`);
  if (transfer) console.log(`  ${describeAdmissionChoice(transfer)}`);
  expect(transfer?.key === 'engineering' && !transfer.front, 'a student transferring in from Parkland should get the external transfer route, not front-loaded');
  expect(transfer?.notFor.some((n) => n.key === 'engineering-undeclared' && /transfer students are not eligible/.test(n.reason)), 'a transfer student should be told EU is not for them, in the page\'s words');
  expect(transfer && /not eligible to ICT into EU/.test(describeAdmissionChoice(transfer)), 'the transfer student\'s note should carry the EU page\'s sentence');

  // 4. Already here as a transfer: no route, the college's own sentence.
  const here = choose(psych, 'I transferred to Illinois from Parkland last year and I want to switch into electrical engineering.');
  expect(here && here.route === null && here.notFor.some((n) => n.key === 'engineering-undeclared'), 'a student who entered as a transfer should get no route and the EU refusal');

  // 5. Computer Science: closed to on-campus transfer, and what the Siebel page offers.
  const cs = choose(psych, 'Psychology freshman, I want to switch into computer science.');
  expect(cs?.closed?.major === 'Computer Science' && cs.route === null, 'CS should be closed to on-campus transfer with no route');
  expect(cs?.closed?.offers.some((o) => /CS minor/.test(o)) && cs?.closed?.offers.some((o) => /CS \+ X/.test(o)), 'the closed-CS answer should offer the CS minor and blended CS + X majors');
  const csBoard = choose(computing, "I'm a freshman in LAS undeclared and want to transfer into CS");
  expect(csBoard?.closed && !csBoard.front, 'a CS board for an LAS first-year should front-load nothing');
  for (const [q, want] of [['computer science', 'Computer Science'], ['cs + physics', 'Computer Science + Physics'], ['cs + bioengineering', 'Computer Science + Bioengineering']]) {
    const g = goalFromQuery(table, q, '', { college: 'las', programId: psych.id, programName: psych.name });
    const c = g ? chooseAdmission(table, g, readEntry('freshman', null, START), START) : null;
    expect(c?.closed?.major === want, `program_admission("${q}") should say ${want} is closed`);
  }
  expect(goalFromQuery(table, 'cs + economics', '', { college: 'las', programId: psych.id, programName: psych.name }) === null, 'CS + Economics is an LAS blended major; no Grainger claim');

  // 6. Past the window, and Gies unchanged.
  const junior = choose(psych, "I'm a junior in psychology and want to switch into mechanical engineering.");
  expect(junior && junior.route === null && !junior.front, 'a junior should get no EU route');
  const gies = choose(byId.get('bus/finance-bs'), "I'm a freshman in LAS and want to transfer into Gies for finance.");
  expect(gies?.key === 'bus' && gies.front && gies.route?.dueTermIndex === 1, 'Gies ICT should be chosen and front-loaded as before');

  console.log(admissionProblems ? `*** ${admissionProblems} ADMISSION ROUTE PROBLEMS ***` : 'admission route cases: all pass');
  if (admissionProblems) process.exitCode = 1;
}

console.log('='.repeat(78));
console.log(`TOTAL PREREQUISITE VIOLATIONS: ${prereqErrors}`);
console.log(`TOTAL CLASS STANDING VIOLATIONS: ${standingErrors}`);
console.log(`TOTAL COMPOSITION I LATE OR LANGUAGE GAP FLAGS ON GENERATED BOARDS: ${editFlags}`);
if (editFlags) process.exitCode = 1;

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
