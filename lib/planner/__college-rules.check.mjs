/**
 * What ALMA says a college decides, checked against the pages it was read from.
 *
 * set_plan_shape built six 9-hour terms for "I only want 9 credits" without a
 * word about part-time status; a Grainger freshman asking for 20 hours got a
 * range error instead of Grainger's rule (never in a first semester); "can I
 * take my gen ed pick CR/NC?" had no answer on the card; every Finance plan
 * booked the Gies academies (FIN 391 "Admission by application only") as
 * one-credit electives. Each case below pins one of those to the rule in
 * college-rules.ts or the planner, so the answer cannot drift back.
 *
 *   node lib/planner/__college-rules.check.mjs
 *
 * The planner cases load the catalog the way __plan-notes.check.mjs does.
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

const R = await import(join(HERE, 'college-rules.ts'));
const { advisorSystem } = await import(join(HERE, 'advisor.ts'));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? `: ${detail}` : ''}`));

// ---------------------------------------------------------------------------
console.log('\n=== 1. The college table: each row says what its page says ===\n');

{
  const g = R.collegeRulesFor('engineering');
  expect(/3\.5/.test(g.overload) && /first semester/.test(g.overload) && /22 hours/.test(g.overload) && /noon on the 10th day/.test(g.overload) && /after an underload/.test(g.overload),
    'Grainger: 3.5, none in a first semester, 22 cap, noon on day 10, none after an underload', g.overload);
  expect(/every underload/.test(g.underload), 'Grainger: approval for every underload', g.underload);
  expect(/333-2280/.test(g.office) && /Grainger Library/.test(g.office), 'Grainger: the college advising office with its number', g.office);

  const b = R.collegeRulesFor('bus');
  expect(/19-20 hours/.test(b.overload) && /3\.00/.test(b.overload) && /3\.50/.test(b.overload) && /15-16 hours/.test(b.overload) && /first two semesters/.test(b.overload) && /two approved overloads/.test(b.overload),
    'Gies: 3.00 for 19-20, 3.50 above 20, 15-16 hours twice before, no freshman overload in two semesters, two at most', b.overload);
  expect(/only one semester/.test(b.underload), 'Gies: one underload', b.underload);

  const m = R.collegeRulesFor('media');
  expect(/3\.0/.test(m.overload) && /17-18 hours/.test(m.overload), 'Media: a 3.0 and a 17-18 hour semester first', m.overload);
  expect(/one underload/.test(m.underload) && /graduating semester/.test(m.underload) && /academic warning/.test(m.underload), 'Media: one underload, usually the last term, not on warning', m.underload);

  const l = R.collegeRulesFor('las');
  expect(/day before classes/.test(l.overload), 'LAS: overload entered the day before classes', l.overload);
  expect(/final semester/.test(l.underload) && /documented illness/.test(l.underload) && /not more than once/.test(l.underload), 'LAS: final semester or illness, not more than once', l.underload);
  expect(/2002 Lincoln Hall/.test(l.office) && /1-4:40/.test(l.office), 'LAS: Student Academic Affairs drop-ins', l.office);

  const a = R.collegeRulesFor('aces');
  expect(/good academic standing/.test(a.overload) && /not on academic warning/.test(a.overload), 'ACES: good standing for an overload', a.overload);
  expect(/Mumford Hall/.test(a.office), 'ACES: the Office of Academic Programs', a.office);

  expect(R.collegeRulesFor('faa').overload?.includes('3.0') && R.collegeRulesFor('faa').overload?.includes('21 hours'), 'FAA: a 3.0, more than 21 only in special circumstances');
  expect(R.collegeRulesFor('ENGINEERING').name === g.name, 'the college code is read without regard to case');

  // Every row that states a rule carries the page it was read from.
  for (const code of ['engineering', 'bus', 'media', 'las', 'aces', 'faa', 'ahs']) {
    const row = R.collegeRulesFor(code);
    if (row.sources.length === 0 || !row.sources.every((u) => /^https:\/\/[^/]*illinois\.edu\//.test(u))) fail(`${code}: rules without an illinois.edu source`);
  }
  ok('every row with a rule names its illinois.edu page');
}

{
  // Colleges whose page was not read say to ask, and never borrow another college's rule.
  for (const code of ['education', 'ischool', 'socw', 'vetmed', '', null, undefined]) {
    const row = R.collegeRulesFor(code);
    if (row.overload !== null || row.underload !== null) fail(`${String(code)}: a rule nobody read (${row.overload ?? row.underload})`);
    if (!/office/.test(row.office)) fail(`${String(code)}: no office named (${row.office})`);
  }
  ok('Education, the iSchool, Social Work and unknown colleges carry no rule, only an office to ask');
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. Over 18: the college\'s own answer, never a plan ===\n');

{
  const out = R.overloadAnswer('engineering', 20);
  expect(/20 hours is more than the 18/.test(out) && /never builds it/.test(out) && /first semester/.test(out) && /Grainger college advising/.test(out),
    'a Grainger student asking for 20 hears 18, Grainger\'s first-semester rule and where to go', out);
  const unknown = R.overloadAnswer('education', 21);
  expect(/does not have/.test(unknown) && /ask the College of Education advising office/.test(unknown) && !/3\.\d/.test(unknown), 'an unread college gets "ask", with no invented GPA', unknown);
  const nothing = R.overloadAnswer(undefined, 19);
  expect(/your college's overload rule/.test(nothing) && /your college office/.test(nothing), 'no college at all still reads as a sentence', nothing);
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. Under 12: the registrar\'s warnings, then the college ===\n');

{
  const note = R.underloadNote('bus', 9);
  expect(/9 credits/.test(note) && /under the 12/.test(note) && /college's approval/.test(note) && /will not warn/.test(note), 'the note says 12 is full time, approval is needed, and registration will not warn', note);
  expect(/financial aid/.test(note) && /progress toward the degree/.test(note) && /visa/.test(note), 'aid, degree progress and visa status are named', note);
  expect(/one underload, most often in the final term/.test(note) && /only one semester/.test(note), 'colleges usually approve one, and Gies says so', note);
  const edu = R.underloadNote('education', 6);
  expect(/Ask the College of Education advising office/.test(edu), 'an unread college is told to ask', edu);
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. CR/NC from why the card is on the board ===\n');

{
  const cases = [
    ['elective slot', [], true],
    ['added', [], true],
    ['gen ed pick', ['Humanities & the Arts'], false],
    ['required', [], false],
    ['from a list', [], false],
    ['language', [], false],
    ['prerequisite', [], false],
    ['career track', [], false],
  ];
  for (const [role, tags, want] of cases) {
    const got = R.crncEligibility({ role, tags, college: 'las' });
    if (got.eligible !== want) fail(`${String(role)}: ${String(got.eligible)} (${got.why})`);
  }
  ok('elective slots and free additions yes; required, list, gen ed, language, prerequisite and career-track cards no');

  const comp = R.crncEligibility({ role: 'elective slot', tags: ['Composition I'], college: 'las' });
  expect(comp.eligible === false && /Composition I/.test(comp.why), 'Composition I is never CR/NC, even in an elective slot', comp.why);
  const addedOnList = R.crncEligibility({ role: 'added', tags: [], namedBy: 'Finance Electives', college: 'bus' });
  expect(addedOnList.eligible === false && /Finance Electives/.test(addedOnList.why), 'a course the student added that the degree lists is not a free elective', addedOnList.why);
  const taggedElective = R.crncEligibility({ role: 'elective slot', tags: ['Social & Beh Sci'], college: 'las' });
  expect(taggedElective.eligible === true && /Social & Beh Sci/.test(taggedElective.why), 'an elective carrying a gen ed category says what CR/NC could leave open', taggedElective.why);
  const offBoard = R.crncEligibility({ role: null, tags: [], college: 'las' });
  expect(offBoard.eligible === null, 'a course not on the board has no answer yet', offBoard.why);
  const gies = R.crncEligibility({ role: 'elective slot', tags: [], college: 'bus' });
  expect(/LAS's rule/.test(gies.why) && /Gies College of Business/.test(gies.why) && /undergrads@business\.illinois\.edu/.test(gies.why), 'outside LAS the answer names LAS\'s rule and the student\'s own office', gies.why);
  const las = R.crncEligibility({ role: 'gen ed pick', tags: [], college: 'las' });
  expect(/LAS's rule\)/.test(las.why) && !/confirm with/.test(las.why), 'an LAS student gets the rule without a detour', las.why);
  const track = R.crncEligibility({ role: 'career track', tags: [], college: 'las', track: 'pre-physical therapy' });
  expect(/pre-physical therapy/.test(track.why) && /10 percent/.test(track.why), 'a career-track card names the goal and LAS\'s 10 percent warning', track.why);
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. Programs a student applies to, read from the career words ===\n');

{
  const codes = (career) => R.applicationProgramsFor(career).map((p) => p.code).join(',');
  const cases = [
    ['Investment banking or corporate finance.', 'FIN 390,FIN 391'],
    ['asset management, maybe the CFA', 'FIN 390,FIN 392'],
    ['commercial real estate', 'FIN 395'],
    ['risk management', 'FIN 393'],
    ['venture capital', 'FIN 396'],
    ['Finance at Gies.', ''],
    ['data science', ''],
    ['', ''],
  ];
  for (const [career, want] of cases) {
    const got = codes(career);
    if (got !== want) fail(`"${career}": [${got}], expected [${want}]`);
  }
  ok('investment banking, asset management, real estate, risk management and venture capital each name their academy; a bare major names none');
  const line = R.describeApplicationPrograms('investment banking');
  expect(/FIN 391 Investment Banking Academy/.test(line) && /sophomores and juniors/.test(line) && /never book/.test(line), 'the board line names the academy, who applies, and that it is never booked', line);
  expect(R.describeApplicationPrograms('biology') === null, 'no line for a goal with no application program');
  for (const p of R.APPLICATION_PROGRAMS) if (!/^https:\/\/[^/]*illinois\.edu\//.test(p.source)) fail(`${p.code}: source ${p.source}`);
  ok('every application program names its illinois.edu page');
}

// ---------------------------------------------------------------------------
console.log('\n=== 6. The prompt carries the rules, once ===\n');

{
  const prompt = advisorSystem('ALMA');
  const needs = [
    ['grade replacement grades', /C-, D\+, D, D- or F/],
    ['grade replacement budget', /4 distinct courses and 10 hours/],
    ['CR/NC limits', /at most two courses a semester for a full-time student, one in summer/],
    ['the Fall 2026 halfway deadline', /Oct 16 is the last day to drop with no W/],
    ['today\'s date rule', /a date before today has passed/],
    ['the CARE Center first', /Connie Frank CARE Center \(217-333-0050/],
    ['the Emergency Dean', /217-649-4129/],
    ['no board edits in a wellbeing case', /stop planning and make no board edits/],
    ['academic warning shape', /at least 12 graded hours that count toward the degree, no CR\/NC/],
    ['internship summers', /internship summers/],
    ['holds', /you cannot see holds/],
  ];
  for (const [what, re] of needs) if (!re.test(prompt)) fail(`the prompt lost ${what}`);
  ok('grade replacement, CR/NC, deadlines, today, wellbeing, warning, internships and holds are in the prompt');
  expect(!/grade replacement is theirs to decide/.test(prompt), 'the old "registrar\'s rules" retake sentence is gone');
  expect((prompt.match(/4 distinct courses/g) ?? []).length === 1 && (prompt.match(/217-333-0050/g) ?? []).length === 1, 'each rule is stated once');
  expect(!/\$\{/.test(prompt), 'no template placeholder leaked into the prompt');
}

// ---------------------------------------------------------------------------
console.log('\n=== 7. The planner never books an application-only course ===\n');

const { generatePlan, prereqNeedsAdmission } = await import(join(HERE, 'autoplan.ts'));
{
  const cases = [
    ['Admission by application only.', true],
    ['Acceptance into the Risk Management Academy. Restricted to students accepted in the Risk Management Academy.', true],
    ['Induction into the Finance Academy. Restricted to Freshman students in their second semester.', true],
    ['Instructor approval required. Students accepted into the Academy will be allowed to participate in their Freshman, Sophomore, Junior, and Senior years.', true],
    ['Application process. Junior or senior class standing.', true],
    ['Admission to the Secondary Teacher Education Program.', true],
    ['MATH 221; solved by application of the chain rule.', false],
    ['FIN 221 and FIN 300.', false],
  ];
  for (const [text, want] of cases) if ((prereqNeedsAdmission(text) !== null) !== want) fail(`"${text}" read as ${prereqNeedsAdmission(text)}`);
  ok('application, acceptance, induction and admission sentences are gates; "by application of" and plain prerequisites are not');
}

const { buildIllinoisData, gradeFootnote, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const read = (n) => (existsSync(join(PUBLIC, n)) ? JSON.parse(readFileSync(join(PUBLIC, n), 'utf8')) : null);
const data = buildIllinoisData({ catalog: read('illinois-catalog.json'), programs: read('illinois-programs.json'), grades: read('illinois-grades.json'), sections: read('illinois-sections.json') });
const prereqs = new Map();
const creditRanges = new Map();
for (const [code, fact] of data.facts) { if (fact.prereq) prereqs.set(code, fact.prereq); creditRanges.set(code, fact.creditRange); }
const normCode = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();
const offeringsFile = read('illinois/offerings.json');
if (offeringsFile) applyOfferings(data.courses, offeringsFile);
const excellentFile = read('illinois/excellent.json');
const season = (data.sectionTerm?.term ?? 'fall').toLowerCase();
const context = {
  courses: data.courses, prereqs, grades: data.grades, sections: data.sections, equivalents: data.equivalents,
  exclusions: new Map(Object.entries(read('illinois/exclusions.json') ?? {})),
  excellent: excellentFile ? new Map(Object.entries(excellentFile.courses)) : undefined, excellentTerms: excellentFile ? excellentFile.terms : undefined,
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
const FOUR_YEARS = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030 };
{
  const gated = ['FIN 390', 'FIN 391', 'FIN 392', 'FIN 393', 'FIN 394', 'FIN 395', 'FIN 396'].filter((c) => prereqNeedsAdmission(prereqs.get(c)?.text) === null);
  expect(gated.length === 0, 'the catalog load reads every Gies academy as behind an application', gated.join(', '));
  const id = 'bus/finance-bs';
  if (!byId.has(id)) console.log(`  (${id} is not in this crawl)`);
  else {
    const program = byId.get(id);
    // Marcus: Finance at Gies, headed for investment banking. Before the fix
    // his board held FIN 391, 392, 393, 394 and 395 as elective slots.
    for (const career of ['Investment banking or corporate finance.', '']) {
      const plan = generatePlan({
        requirements: data.requirementBlocks.get(id) ?? [], context, prior: { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true }, horizon: FOUR_YEARS, programId: id,
        preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: { workload: 1, teaching: 1, relevance: 2, coverage: 1, schedule: 0 } },
        degreeTotal: program.totalCredits ?? null, programName: program.name, programCollege: program.college,
        interests: 'Finance at Gies.', career,
      });
      // The academies by name as well as by the gate, so the case fails on the
      // old planner even if the gate reading regresses with it.
      const booked = plan.terms.flatMap((t) => t.codes).filter((c) => /^FIN 39[0-6]$/.test(c) || prereqNeedsAdmission(prereqs.get(c)?.text) !== null);
      expect(booked.length === 0, `Finance${career ? ', investment banking' : ', no goal'}: no application-only course on the board`, booked.join(', '));
    }
  }
}

console.log(`\n${failures === 0 ? 'ALL COLLEGE RULE CHECKS PASSED' : `${failures} COLLEGE RULE CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
