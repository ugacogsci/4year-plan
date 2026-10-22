/**
 * UGA summers, from the UGA Bulletin (2026-10-22).
 *
 * Before this, scripts/enrich-uga.mjs read each course's "Semester Course
 * Offered" line and kept fall and spring only, so not one of UGA's 14,092
 * courses ran in summer: a UGA summer was never filled, every class put in
 * one showed "Not offered this term", and ARCH could not reshape a plan
 * (set_plan_shape and set_priorities were held back). scripts/apply-uga-
 * offered.mjs wrote the Bulletin's summers into public/uga-catalog.json, and
 * lib/planner/summer-offering.ts reads them. This check builds real boards the
 * way the browser does (uga-source.tsx over public/uga-*) and fails when:
 *
 *   1. the catalog's summers are not the Bulletin's (3,088 courses, 33 every
 *      odd-numbered summer, 21 every even one), or a row naming no season
 *      reads as a summer;
 *   2. a UGA course's fall and spring read differently from before summers
 *      were listed (the same seasons, the same "verified" flag), or a board
 *      with no summer differs from the board the old seasons give;
 *   3. a summer the student chose is not filled, holds more than 9 credits,
 *      or holds a class the Bulletin does not list for summer, or one listed
 *      for every other summer in the wrong year;
 *   4. the board says "Not offered this term" for a class the Bulletin lists
 *      for that summer, or does not say it, in the Bulletin's words, for one
 *      it does not;
 *   5. set_plan_shape's rule for UGA is not UGA's (18 hours a term, more with
 *      the advisor's approval, 12 full time), calls 9 a UGA limit, or names
 *      Illinois; a plan shaped from the chat (summers, a finish, a term away)
 *      or re-picked with set_priorities breaks the summer rules; a Double
 *      Dawgs board's summer is not filled by the same rules;
 *   6. the board, the course panel or ARCH still say UGA's summer list is not
 *      loaded.
 *
 *   node lib/planner/__uga-summer.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
// Extensionless and '@/' imports, and uga-source.tsx transpiled, as __summer-terms.check.mjs loads it.
register('data:text/javascript,' + encodeURIComponent(`
  import { readFile } from 'node:fs/promises';
  import ts from ${JSON.stringify(pathToFileURL(join(ROOT, 'node_modules/typescript/lib/typescript.js')).href)};
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) {
      try { return await next(spec + '.ts', ctx); } catch {}
      try { return await next(spec + '.tsx', ctx); } catch {}
    }
    return next(spec, ctx);
  }
  export async function load(url, ctx, next) {
    if (url.endsWith('.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(await readFile(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
      }).outputText
    };
    return next(url, ctx);
  }
`));

const SO = await import(join(HERE, 'summer-offering.ts'));
const LR = await import(join(HERE, 'uga-load-rules.ts'));
const A = await import(join(HERE, 'advisor.ts'));
const ST = await import(join(HERE, 'summer-terms.ts'));
const S = await import(join(HERE, 'saved-board.ts'));
const R = await import(join(HERE, 'repick.ts'));
const D = await import(join(HERE, 'double-dawgs.ts'));
const G = await import(join(HERE, 'uga-planning-guidance.ts'));
const { generatePlan, validatePlan } = await import(join(HERE, 'autoplan.ts'));
const { DEFAULT_PRIORITIES } = await import(join(HERE, 'priorities.ts'));
const read = (name) => JSON.parse(readFileSync(join(PUBLIC, name), 'utf8'));
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => new Response(JSON.stringify(read((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
const U = await import(join(ROOT, 'components/planner/uga-source.tsx'));
const data = await U.loadUgaData();
globalThis.fetch = originalFetch;

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) { passes += 1; console.log(`  ok    ${name}`); return; }
  failures += 1;
  console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
}
const section = (title) => console.log(`\n${title}`);
const json = (v) => JSON.stringify(v);
const yearOf = (term) => SO.calendarYearOf(term);
const byId = new Map(data.courses.map((c) => [c.id, c]));
const creditsOf = (ids) => ids.reduce((n, id) => n + (byId.get(id)?.credits ?? 0), 0);

// ---------------------------------------------------------------------------
section("1. The catalog's summers are the UGA Bulletin's");
const catalog = read('uga-catalog.json');
{
  const with_ = (pred) => catalog.filter(pred).length;
  check('3,088 of 14,092 rows list summer, as the Bulletin pages read on 2026-10-15 and 2026-10-20 name it', catalog.length === 14092 && with_((r) => r.offeredIn.includes('Summer')) === 3088, String(with_((r) => r.offeredIn.includes('Summer'))));
  check('33 are offered every odd-numbered summer and 21 every even one, and only summer rows say so', with_((r) => r.summerYears === 'odd') === 33 && with_((r) => r.summerYears === 'even') === 21 && with_((r) => r.summerYears && !r.offeredIn.includes('Summer')) === 0);
  check('572 are summer only; 5,989 name no season ([]): "Offered every year.", "Not offered on a regular basis." or no line at all', with_((r) => json(r.offeredIn) === json(['Summer'])) === 572 && with_((r) => r.offeredIn.length === 0) === 5989);
  check('every row lists its seasons in calendar order, nothing but Fall, Spring and Summer', catalog.every((r) => json(r.offeredIn) === json(['Fall', 'Spring', 'Summer'].filter((s) => r.offeredIn.includes(s)))));
  // The planner's own reading, unit by unit.
  check('a row naming no season plans as fall or spring, unverified, and never as a summer', json(SO.ugaPlannerSeasons([])) === json({ offeredIn: ['Fall', 'Spring'], offeringKnown: false }) && json(SO.ugaPlannerSeasons(undefined)) === json({ offeredIn: ['Fall', 'Spring'], offeringKnown: false }));
  check('summer only: summer, beside the unverified fall and spring default it always had', json(SO.ugaPlannerSeasons(['Summer'])) === json({ offeredIn: ['Fall', 'Spring', 'Summer'], offeringKnown: false }));
  check('fall and summer: fall verified, as fall alone was, plus summer', json(SO.ugaPlannerSeasons(['Fall', 'Summer'])) === json({ offeredIn: ['Fall', 'Summer'], offeringKnown: true }) && json(SO.ugaPlannerSeasons(['Spring'])) === json({ offeredIn: ['Spring'], offeringKnown: true }));
  check('fall, spring and summer: fall and spring unverified, as fall and spring were', json(SO.ugaPlannerSeasons(['Fall', 'Spring', 'Summer'])) === json({ offeredIn: ['Fall', 'Spring', 'Summer'], offeringKnown: false }));
  const odd = { offeredIn: ['Summer'], summerYears: 'odd' };
  check('an odd-year course runs in Summer 2027 and 2029, not 2028; an even one the other way', SO.runsInSummer(odd, 2027) && SO.runsInSummer(odd, 2029) && !SO.runsInSummer(odd, 2028) && SO.runsInSummer({ offeredIn: ['Summer'], summerYears: 'even' }, 2028) && !SO.runsInSummer({ offeredIn: ['Summer'], summerYears: 'even' }, 2027));
  check('with the year unknown, an every-other-year course is not counted on; an every-summer one is', !SO.runsInSummer(odd, null) && SO.runsInSummer({ offeredIn: ['Summer'] }, null) && !SO.runsInSummer({ offeredIn: ['Fall'] }, 2027));
  check('Summer 2027 reads as 2027 from its label or its id', yearOf({ label: 'Summer 2027' }) === 2027 && yearOf({ id: 'summer-2028' }) === 2028 && yearOf({ label: 'Summer' }) === null);
}

// ---------------------------------------------------------------------------
section('2. Fall and spring read exactly as before summers were listed');
{
  // The old reading (uga-source.tsx at cd59ed3): offeredIn as the row printed
  // it, ["Fall","Spring"] when empty, and "verified" unless it was exactly
  // Fall and Spring. The old rows were these rows without Summer, and with
  // ["Fall","Spring"] where they now name nothing.
  const oldRead = (row) => {
    const named = row.offeredIn.filter((s) => s !== 'Summer');
    const offeredIn = named.length ? named : ['Fall', 'Spring'];
    return { offeredIn, offeringKnown: offeredIn.length !== 2 || !offeredIn.includes('Fall') || !offeredIn.includes('Spring') };
  };
  const rows = new Map(catalog.map((r) => [r.code, r]));
  // A dual listing ("AAEC 4510/6510") is one row and two planner courses; each carries the row's own line.
  const direct = data.courses.filter((c) => rows.has(c.code));
  check(`each planner course carries its row's own offering line (${direct.length} checked by code)`, direct.length > 11000 && direct.every((c) => json(c.offeringListed) === json(rows.get(c.code).offeredIn) && (c.summerYears ?? null) === (rows.get(c.code).summerYears ?? null)));
  let moved = 0;
  for (const course of data.courses) {
    const was = oldRead({ offeredIn: course.offeringListed ?? [] });
    const fallSpring = course.offeredIn.filter((s) => s !== 'Summer');
    if (json(fallSpring) !== json(was.offeredIn) || course.offeringKnown !== was.offeringKnown) moved += 1;
  }
  check(`every one of the planner's ${data.courses.length} UGA courses keeps its fall and spring seasons and its "verified" flag`, data.courses.length > 14000 && moved === 0, `${moved} moved`);
  check('a course gets Summer only where its line lists it', data.courses.every((c) => c.offeredIn.includes('Summer') === (c.offeringListed ?? []).includes('Summer')));
}

// The boards: a Fall 2026 freshman, Spring 2030 stated, the workspace's defaults.
const selectionsFor = (program) => Object.fromEntries(U.ugaSelectionRequirements(program).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
const inputFor = (program, { summers = [], context = data.context, finish = { season: 'Spring', year: 2030 }, away = [] } = {}) => {
  const loaded = U.loadUgaProgram(data, program, { emphasisSelections: selectionsFor(program) });
  return {
    loaded,
    input: {
      requirements: loaded.blocks,
      context: { ...context, samplePlanCourses: G.sampleCoursesFor(G.samplePlansFor(data.guidance, [program.id])) },
      prior: { known: true, courseCodes: [], exemptCodes: [], unmatchedCredits: 0 },
      horizon: { startSeason: 'Fall', startYear: 2026, gradSeason: finish.season, gradYear: finish.year, stated: true, summers, away },
      preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: DEFAULT_PRIORITIES },
      programId: program.id, programName: loaded.program.name, programCollege: loaded.program.college,
      degreeTotal: program.totalCredits || null, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
      interests: '', career: '',
    },
  };
};
// Across colleges: Franklin (four), Terry, Engineering, Grady, and Psychology first for the checks below.
const PROGRAMS = ['Psychology BS', 'Computer Science BS', 'Biology BS', 'Cognitive Science AB', 'Finance BBA', 'English AB', 'Mechanical Engineering BSME', 'Journalism AB']
  .map((name) => data.programs.find((p) => p.name === name)).filter(Boolean);

// ---------------------------------------------------------------------------
section('2b. A board with no summer is the board the old seasons give');
{
  // The catalog as it was before summers were listed: every course's seasons
  // without Summer. Copied after each program loads, since loading one marks
  // the catalog's courses with that program's requirements.
  const withoutSummers = () => data.courses.map((c) => {
    const { summerYears: _y, offeringListed: _l, ...rest } = c;
    return { ...rest, offeredIn: c.offeredIn.filter((s) => s !== 'Summer') };
  });
  const differ = [];
  for (const program of PROGRAMS) {
    const { input } = inputFor(program);
    const now = generatePlan(input);
    const before = generatePlan({ ...input, context: { ...input.context, courses: withoutSummers() } });
    if (json(now.plan) !== json(before.plan) || json(now.notes) !== json(before.notes) || json(now.notPlaced) !== json(before.notPlaced)) differ.push(program.name);
  }
  check(`${PROGRAMS.length} programs (${PROGRAMS.map((p) => p.name).join(', ')}): no summer, the same board, notes and unplaced courses, byte for byte`, PROGRAMS.length === 8 && differ.length === 0, differ.join(', '));
  console.log('        (scripts/dev/uga-boards.mjs compares every bachelor\'s program and Double Dawgs pathway against the commit before summers)');
}

// ---------------------------------------------------------------------------
section('3. A summer the student chose fills by the summer rules');
const summerFaults = (plan) => {
  const faults = [];
  for (const term of plan.terms.filter((t) => t.season === 'Summer')) {
    const credits = creditsOf(term.courseIds);
    if (credits > 9) faults.push(`${term.label} holds ${credits} credits`);
    for (const id of term.courseIds) {
      const c = byId.get(id);
      if (!c || !SO.runsInSummer(c, yearOf(term))) faults.push(`${term.label}: ${c?.code ?? id} (${c?.offeredIn}${c?.summerYears ? `, ${c.summerYears} years` : ''})`);
      if (c && (c.offeringListed ?? []).length === 0) faults.push(`${term.label}: ${c.code} names no season`);
    }
  }
  return faults;
};
const boards = [];
{
  let filled = 0;
  let summers = 0;
  for (const program of PROGRAMS) {
    const { input, loaded } = inputFor(program, { summers: [2027, 2028] });
    const plan = generatePlan(input).plan;
    boards.push({ program, plan, input, loaded });
    const faults = summerFaults(plan);
    const held = plan.terms.filter((t) => t.season === 'Summer');
    summers += held.length;
    filled += held.filter((t) => t.courseIds.length > 0).length;
    console.log(`        ${program.name}: ${held.map((t) => `${t.label} ${t.courseIds.map((id) => byId.get(id)?.code).join(', ') || 'empty'} (${creditsOf(t.courseIds)} cr)`).join('; ')}`);
    check(`${program.name}: Summer 2027 and Summer 2028 on the board, each at most 9 credits of classes the Bulletin lists for that summer`, held.length === 2 && faults.length === 0, faults.join('; '));
  }
  check(`the summers are filled: ${filled} of ${summers} hold classes (none could before)`, summers > 0 && filled >= summers - 2, `${filled}/${summers}`);
}

// ---------------------------------------------------------------------------
section('4. "Not offered this term" in a UGA summer: never for a class the Bulletin lists, always in its words');
{
  const { plan, input } = boards[0];
  const issues = validatePlan(plan, input.context);
  const offering = issues.filter((i) => i.id.startsWith('ap-offering-summer-'));
  check(`${boards[0].program.name}: no "Not offered this term" on the summers the planner filled`, offering.length === 0, offering.map((i) => i.message).join(' | '));
  const course = (code) => data.courses.find((c) => c.code === code);
  const put = (board, label, code) => ({ ...board, terms: board.terms.map((t) => (t.label === label ? { ...t, courseIds: [...t.courseIds, course(code).id] } : t)) });
  const flags = (board, code, label) => validatePlan(board, input.context).filter((i) => i.courseId === course(code).id && i.termId === board.terms.find((t) => t.label === label)?.id && i.id.startsWith('ap-offering-'));
  check('the premise: GREK 2050 is offered every odd-numbered summer, LATN 2050 every even one, PSYC 3240 in fall and odd summers', course('GREK 2050')?.summerYears === 'odd' && course('LATN 2050')?.summerYears === 'even' && json(course('PSYC 3240')?.offeredIn) === json(['Fall', 'Summer']) && course('PSYC 3240')?.summerYears === 'odd');
  check('GREK 2050 in Summer 2027 (odd): no flag', flags(put(plan, 'Summer 2027', 'GREK 2050'), 'GREK 2050', 'Summer 2027').length === 0);
  const wrong = flags(put(plan, 'Summer 2028', 'GREK 2050'), 'GREK 2050', 'Summer 2028');
  check('GREK 2050 in Summer 2028 (even): "Not offered this term", saying the Bulletin offers it only in odd-numbered years', wrong.length === 1 && wrong[0].title === 'Not offered this term' && /The UGA Bulletin offers GREK 2050 in summer only in odd-numbered years, and Summer 2028 is not one/.test(wrong[0].message), wrong.map((i) => i.message).join(' | '));
  check('LATN 2050 the other way round', flags(put(plan, 'Summer 2028', 'LATN 2050'), 'LATN 2050', 'Summer 2028').length === 0 && flags(put(plan, 'Summer 2027', 'LATN 2050'), 'LATN 2050', 'Summer 2027').length === 1);
  const noSeason = data.courses.find((c) => (c.offeringListed ?? []).length === 0 && c.credits === 3 && /^[A-Z]+ [1-2]\d{3}$/.test(c.code) && !input.context.prereqs?.get(c.code));
  const none = flags(put(plan, 'Summer 2027', noSeason.code), noSeason.code, 'Summer 2027');
  check(`a class whose Bulletin line names no season (${noSeason.code}) in a summer: flagged, in the Bulletin's words, not "has run only in"`, none.length === 1 && new RegExp(`The UGA Bulletin does not list ${noSeason.code} for summer`).test(none[0].message) && !/has run only in/.test(none[0].message), none.map((i) => i.message).join(' | '));
  const fallOnly = data.courses.find((c) => json(c.offeringListed) === json(['Fall']) && c.credits === 3 && !input.context.prereqs?.get(c.code));
  const inSpring = flags(put(plan, 'Spring 2028', fallOnly.code), fallOnly.code, 'Spring 2028');
  check(`a fall-only class in a spring keeps its old flag word for word (${fallOnly.code})`, inSpring.length === 1 && inSpring[0].message === `${fallOnly.code} has run only in Fall terms over the last few terms, and this is a Spring term.`, inSpring.map((i) => i.message).join(' | '));
}

// ---------------------------------------------------------------------------
section("5. ARCH's plan shape and priorities on UGA boards");
{
  const over = LR.ugaOverloadAnswer(20);
  check("above 18: UGA's Registrar's 18 for fall, spring and summer, a higher credit limit with the advisor's approval, the page, and no number past it", /20 hours is more than the 18 UGA lets an undergraduate register for in a fall, spring or summer term/.test(over) && /academic advisor's approval/.test(over) && over.includes('https://reg.uga.edu/registration/schedule-adjustments/') && /names no ceiling above 18 and no grade-point rule/.test(over), over);
  const under = LR.ugaUnderloadNote(9);
  check('under 12: UGA counts 12 full time (9 to 11.99 three-quarter), financial aid 12 too, with the pages', /under the 12 hours UGA's Registrar counts as full time/.test(under) && /9 to 11.99 hours is three-quarter time/.test(under) && under.includes(LR.UGA_ENROLLMENT_PAGE) && under.includes(LR.UGA_AID_PAGE), under);
  const words = [over, under, ...A.ugaAdvisorTools().filter((t) => ['set_plan_shape', 'set_priorities', 'add_summer'].includes(t.name)).map((t) => JSON.stringify(t))].join(' ');
  check('none of it names Illinois, its colleges or the LAS 18', !/Illinois|Grainger|Gies|\bLAS\b|Teachers Ranked/.test(words));
  check('nothing calls the 9-credit summer a UGA rule', !/UGA'?s? (?:9|nine)|9 in summer|summer (?:limit|maximum) of 9/i.test(words) && /its own ceiling under UGA's 18-hour term limit/.test(words));

  // set_plan_shape: a finish, a term away and a summer, rebuilt the way the workspace rebuilds.
  const program = PROGRAMS[0];
  const shape = { ...S.NO_SHAPE, finish: { season: 'Fall', year: 2029 }, away: [{ season: 'Spring', year: 2028, kind: 'study_abroad', credits: 15 }], summers: [2027, 2028, 2029] };
  const { input } = inputFor(program, { summers: ST.summersFor([], shape), finish: shape.finish, away: shape.away });
  const shaped = ST.withAddedSummers(generatePlan(input).plan, shape);
  const labels = shaped.terms.map((t) => t.label);
  check(`${program.name}: finish Fall 2029, abroad Spring 2028, summers 2027 to 2029: the board ends in Fall 2029 with no Spring 2028 and all three summers`, labels.at(-1) === 'Fall 2029' && !labels.includes('Spring 2028') && ['Summer 2027', 'Summer 2028', 'Summer 2029'].every((l) => labels.includes(l)), labels.join(', '));
  check('and its summers keep the summer rules', summerFaults(shaped).length === 0, summerFaults(shaped).join('; '));

  // set_priorities: the re-pick the workspace runs, on a board with summers.
  const { plan, loaded } = boards[0];
  const generated = generatePlan(boards[0].input);
  const marks = R.planMarks(generated, data.byCode);
  for (const [label, priorities, interests] of [['relevance, "data science and statistics"', { ...DEFAULT_PRIORITIES, relevance: 2 }, 'data science and statistics'], ['the lightest preset', { ...DEFAULT_PRIORITIES, workload: 2, teaching: 0, relevance: 0 }, '']]) {
    const repicked = R.repickBoard({
      context: boards[0].input.context, requirements: loaded.blocks, board: plan, marks, pools: generated.pools,
      prior: boards[0].input.prior, interests, career: interests, programName: loaded.program.name, priorities,
      minimumTermCredits: 12, priorCredits: 0, degreeTotal: program.totalCredits,
    });
    const codes = repicked.board.terms.flatMap((t) => t.courseIds);
    check(`re-picked for ${label}: ${repicked.changes.length} change(s), every course a UGA one, the summers still by the rules, no term past 18`, codes.every((id) => byId.has(id)) && summerFaults(repicked.board).length === 0 && repicked.board.terms.every((t) => creditsOf(t.courseIds) <= 18), [...summerFaults(repicked.board), repicked.changes.map((c) => `${c.from}->${c.to} ${c.term}`).join(', ')].join('; '));
  }

  // Double Dawgs: a summer inside the bachelor's years fills by the same rules.
  const pathway = data.guidance.pathways.find((p) => p.id === '17003');
  const ddProgram = data.programs.find((p) => p.id === pathway.undergraduateProgramIds[0]);
  const { input: ddInput, loaded: ddLoaded } = inputFor(ddProgram, { summers: [2028], finish: { season: 'Spring', year: 2030 } });
  const graduate = D.withDoubleDawgsGraduateRules(U.loadUgaProgram(data, data.programs.find((p) => p.id === pathway.graduateProgramIds[0]), { resetRequirements: false }), data.context);
  const shared = D.selectSharedCourses(pathway, D.doubleDawgsOptions(pathway, ddLoaded, graduate, data.byCode, data.dualLevelCourses));
  const dd = D.generateDoubleDawgs({ undergraduate: ddInput, undergraduateProgram: ddLoaded.program, graduate, pathway, shared, graduateFinish: { season: 'Spring', year: 2031 } }).plan;
  const ddSummer = ST.summerOn(dd, 2028);
  console.log(`        ${pathway.name}: Summer 2028 ${ddSummer ? ddSummer.courseIds.map((id) => byId.get(id)?.code).join(', ') || 'empty' : 'missing'}`);
  check(`Double Dawgs (${pathway.name}): Summer 2028 is on the board, filled by the summer rules`, Boolean(ddSummer) && ddSummer.courseIds.length > 0 && summerFaults(dd).length === 0, summerFaults(dd).join('; '));
}

// ---------------------------------------------------------------------------
section("6. The words: the board, the course panel and ARCH say where UGA's summers come from");
{
  const src = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  check('the empty UGA summer column says Rebuild fills it from the Bulletin, up to 9 credits', src.includes("const UGA_SUMMER_NOTE = 'Rebuild fills this summer with classes the UGA Bulletin lists for summer, up to 9 credits. Or add classes yourself.';"));
  check("nothing on the board, in ARCH's tools or in its prompt says UGA's summer list is not loaded or that ORION does not have it", !/summer course list (?:is not loaded|yet)/.test(src) && !/summer course list is not loaded/.test(A.advisorSystem('ARCH', 'University of Georgia', 'UGA')) && !A.ugaAdvisorTools().some((t) => /summer course list is not loaded/.test(t.description)));
  const line = (code) => SO.ugaOfferingLine(data.courses.find((c) => c.code === code));
  check('the course panel and course_details read the Bulletin line: "fall and summer", "summer in odd-numbered years", "names no term"', line('PSYC 3240') === 'The UGA Bulletin lists it for fall and summer in odd-numbered years.' && line('GREK 2050') === 'The UGA Bulletin lists it for summer in odd-numbered years.' && /lists it for fall, spring and summer\.$/.test(line('ENGL 1102')) && /^The UGA Bulletin names no term for it/.test(SO.ugaOfferingLine({ offeringListed: [] })), [line('PSYC 3240'), line('GREK 2050'), line('ENGL 1102')].join(' | '));
  const panel = readFileSync(join(ROOT, 'components/planner/course-detail.tsx'), 'utf8');
  check('the course panel shows that line for a UGA course', /course\.offeringListed\s*\?\s*ugaOfferingLine\(course\)/.test(panel));
}

console.log(`\n${passes} passed, ${failures} failed`);
console.log(failures === 0 ? 'ALL UGA SUMMER CHECKS PASSED' : `${failures} UGA SUMMER CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
