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
 *      with no summer differs from the board the old seasons give, other
 *      than by leaving out the summer-only classes it used to book;
 *   3. a summer the student chose is not filled, holds more than 9 credits,
 *      or holds a class the Bulletin does not list for summer, or one listed
 *      for every other summer in the wrong year;
 *   4. the board says "Not offered this term" for a class the Bulletin lists
 *      for that summer, or does not say it, in the Bulletin's words, for one
 *      it does not; the planner books a class the Bulletin lists for summer
 *      only in a fall or spring, offers one there in a card's dropdown or a
 *      re-pick, or (4c) drops one the degree requires with no other choice
 *      instead of keeping it, in a summer when one can take it, or with a
 *      card that says to add a summer; (4d) on today's Spring 2027 boards,
 *      the card points to a summer Add a summer cannot add, or a required
 *      one loses the plan's summer to general education picks; (4e) a
 *      summer-only pick is not traded in its own seat, or the board meets
 *      fewer requirements for it;
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
section('2b. A board with no summer is the board the old seasons give, but for the summer-only classes it used to book');
{
  // The catalog as it was before summers were listed: every course's seasons
  // without Summer and without its Bulletin line, so nothing reads as summer
  // only. Copied after each program loads, since loading one marks the
  // catalog's courses with that program's requirements.
  const withoutSummers = () => data.courses.map((c) => {
    const { summerYears: _y, offeringListed: _l, ...rest } = c;
    return { ...rest, offeredIn: c.offeredIn.filter((s) => s !== 'Summer') };
  });
  // Since 2026-10-22 (the owner's decision) the planner's own picks leave a
  // class the Bulletin lists for summer only out of falls and springs. A board
  // that never booked one is the old board byte for byte; one that did holds
  // none now and leaves no more required class off.
  const summerOnlyIn = (plan) => plan.terms.filter((t) => t.season !== 'Summer').flatMap((t) => t.courseIds.map((id) => byId.get(id)).filter((c) => SO.summerOnlyListed(c)).map((c) => c.code));
  const differ = [];
  const still = [];
  const moved = [];
  const gatedOff = [];
  for (const program of PROGRAMS) {
    const { input: planned } = inputFor(program);
    // With the free choices' reading (autoplan.ts freeChoicesGated) the planner books none in a fall or spring.
    const gated = generatePlan(planned).plan;
    if (summerOnlyIn(gated).length > 0) gatedOff.push(`${program.name}: ${summerOnlyIn(gated).join(', ')}`);
    // The listing's own effect is checked on the picks as they were made when it was written: without the reading
    // and the Schedule of Classes (freeChoices 'off', no schedule), whose seasons the old catalog cannot strip.
    const input = { ...planned, freeChoices: 'off', context: { ...planned.context, scheduled: undefined } };
    const now = generatePlan(input);
    const before = generatePlan({ ...input, context: { ...input.context, courses: withoutSummers() } });
    const had = summerOnlyIn(before.plan);
    if (had.length === 0) {
      if (json(now.plan) !== json(before.plan) || json(now.notes) !== json(before.notes) || json(now.notPlaced) !== json(before.notPlaced)) differ.push(program.name);
      continue;
    }
    moved.push(`${program.name} (${had.join(', ')})`);
    if (summerOnlyIn(now.plan).length > 0) still.push(`${program.name}: ${summerOnlyIn(now.plan).join(', ')}`);
    if (now.notPlaced.length > before.notPlaced.length) differ.push(`${program.name} leaves ${now.notPlaced.length - before.notPlaced.length} more required class(es) off`);
  }
  console.log(`        boards that booked a summer-only class in a fall or spring before: ${moved.join('; ') || 'none'}`);
  check(`${PROGRAMS.length} programs with no summer: a board that booked no summer-only class is the same board, notes and unplaced courses, byte for byte; one that did holds none in a fall or spring now and leaves no more required class off`, PROGRAMS.length === 8 && moved.length > 0 && differ.length === 0 && still.length === 0, [...differ, ...still].join(', '));
  check('and with the free choices\' reading none of the eight boards holds a summer-only class in a fall or spring', gatedOff.length === 0, gatedOff.join('; '));
  console.log('        (scripts/dev/uga-harness.mjs measures every bachelor\'s program for eight kinds of student)');
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
section('4b. A class the Bulletin lists for summer only: the planner leaves it out of falls and springs; one placed there by hand says so (2026-10-22)');
/*
 * 572 UGA courses are listed for summer alone. They keep the fall and spring
 * default every course whose line names neither has (ugaPlannerSeasons), so
 * a class a student placed stays where they put it, but since the owner's
 * decision of 2026-10-22 the planner's own picks treat them as out of season
 * there: ARHI 2121 Introduction to Italian Art was the Humanities pick on 105
 * of 161 UGA freshman boards, each then flagged "Not offered this term". One
 * placed by hand is flagged by the validator itself, in the Bulletin's words.
 */
{
  const { auditUgaBoard } = await import(join(ROOT, 'components/planner/uga-board-audit.ts'));
  const course = (code) => data.courses.find((c) => c.code === code);
  check('the premise: ARHI 2121 is listed for summer only, the planner keeps its unverified fall and spring, and its season is published', json(course('ARHI 2121')?.offeringListed) === json(['Summer']) && json(course('ARHI 2121')?.offeredIn) === json(['Fall', 'Spring', 'Summer']) && course('ARHI 2121')?.offeringKnown === false && data.context.offeringPublished.has('ARHI 2121') && SO.summerOnlyListed(course('ARHI 2121')) && !SO.summerOnlyListed(course('ENGL 1101')));
  const booked = [];
  for (const program of PROGRAMS) {
    const { input } = inputFor(program);
    const plan = generatePlan(input).plan;
    for (const term of plan.terms) for (const id of term.courseIds) if (term.season !== 'Summer' && SO.summerOnlyListed(byId.get(id))) booked.push(`${program.name}: ${byId.get(id).code} ${term.label}`);
  }
  check(`${PROGRAMS.length} no-summer boards book no class the Bulletin lists for summer only in a fall or spring`, booked.length === 0, booked.join(', '));
  const bio = PROGRAMS.find((p) => p.name === 'Biology BS');
  const { loaded, input } = inputFor(bio);
  const plan = generatePlan(input).plan;
  const spring = plan.terms.find((t) => t.season === 'Spring' && t.year >= 2028) ?? plan.terms.find((t) => t.season === 'Spring');
  const withArhi = { ...plan, terms: plan.terms.map((t) => (t.id === spring.id ? { ...t, courseIds: [...t.courseIds.filter((id) => id !== course('ARHI 2121').id), course('ARHI 2121').id] } : { ...t, courseIds: t.courseIds.filter((id) => id !== course('ARHI 2121').id) })) };
  const said = `The UGA Bulletin lists ARHI 2121 for summer only, so it may not run in ${spring.label}.`;
  const own = validatePlan(withArhi, input.context).filter((i) => i.id === `ap-offering-${spring.id}-${course('ARHI 2121').id}`);
  check(`placed by hand in ${spring.label}: the validator says "${said}"`, own.length === 1 && own[0].title === 'Not offered this term' && own[0].message.startsWith(said), own.map((i) => i.message).join(' | '));
  const audit = auditUgaBoard({ board: withArhi, context: input.context, undergraduate: loaded, priorCodes: [], extraCredits: 0, transcript: null, dualLevel: data.dualLevelCourses, validation: { minimumTermCredits: 12, priorCredits: 0 } });
  const flags = audit.issues.filter((i) => i.id === `ap-offering-${spring.id}-${course('ARHI 2121').id}`);
  check('the board shows it once, in the same words', flags.length === 1 && flags[0].message.startsWith(said), flags.map((i) => i.message).join(' | '));
  const triage = await import(join(HERE, 'warnings-triage.ts'));
  check('the board bar counts it with the other offering warnings: "Course not offered that term", matters now', triage.issueKind(flags[0] ?? { id: '', severity: 'info', title: '', message: '' }).key === 'offering' && triage.issueKind(flags[0]).tier === 'now');
  // The card's dropdown and the re-pick: no summer-only class offered for a fall or spring slot.
  const { electiveOptions } = await import(join(HERE, 'autoplan.ts'));
  const offered = [];
  for (const term of plan.terms.filter((t) => t.season !== 'Summer')) {
    for (const option of electiveOptions({ context: input.context, requirements: loaded.blocks, plan, termId: term.id, prior: input.prior, programName: bio.name, limit: 60 })) {
      if (SO.summerOnlyListed(data.byCode.get(option.code))) offered.push(`${option.code} in ${term.label}`);
    }
  }
  check(`${bio.name}: the card's elective options for its falls and springs offer no summer-only class`, offered.length === 0, offered.join(', '));
  const check_ = R.boardChecker({ context: input.context, board: plan, requirements: loaded.blocks, minimumTermCredits: 12, priorCredits: 0, degreeTotal: bio.totalCredits, programName: bio.name });
  // The swap takes a 3-hour course no row requires, from the first spring from 2028 on that holds one (any spring otherwise).
  const swappable = (c) => c && c.credits === 3 && !loaded.blocks.some((b) => b.rule.kind === 'all' && b.rule.choices.some((ch) => ch.codes.includes(c.code)));
  const springs = plan.terms.filter((t) => t.season === 'Spring');
  const swapAt = [...springs.filter((t) => t.year >= 2028), ...springs].find((t) => t.courseIds.some((id) => swappable(byId.get(id)))) ?? spring;
  const victim = swapAt.courseIds.map((id) => byId.get(id)).find(swappable);
  const swapped = { ...plan, terms: plan.terms.map((t) => (t.id === swapAt.id ? { ...t, courseIds: t.courseIds.map((id) => (id === victim?.id ? course('ARHI 2121').id : id)) } : t)) };
  const verdict = victim ? check_(swapped, plan, swapAt.id, course('ARHI 2121'), victim) : 'no victim';
  check(`a re-pick may not swap ARHI 2121 into ${swapAt.label} (for ${victim?.code ?? '?'})`, typeof verdict === 'string' && verdict.startsWith(`The UGA Bulletin lists ARHI 2121 for summer only, so it may not run in ${swapAt.label}.`), String(verdict));
}

// ---------------------------------------------------------------------------
section('4c. A summer-only class the degree requires with no other choice stays on the board (2026-10-22)');
/*
 * The degree beats everything: 11 of 161 bachelor's degrees require a class
 * the Bulletin lists for summer only, with no other choice (Art BFA -
 * Interior Design's ARID 4010, Geology's GEOL 4270, Forestry's FORS 4650 ...).
 * The planner puts it in a summer when the plan has one it runs in and can
 * take it; otherwise it stays in a fall or spring, and its card says plainly
 * that it is offered in summer and to use Add a summer.
 */
{
  const { auditUgaBoard } = await import(join(ROOT, 'components/planner/uga-board-audit.ts'));
  const design = data.programs.find((p) => p.id === '40512');
  const geology = data.programs.find((p) => p.id === '70540');
  check('the premise: Art BFA - Interior Design requires ARID 4010 and Geology AB GEOL 4270, both listed for summer only', Boolean(design && geology) && SO.summerOnlyListed(data.byCode.get('ARID 4010')) && SO.summerOnlyListed(data.byCode.get('GEOL 4270')));
  const where = (plan, code) => plan.terms.find((t) => t.courseIds.includes(data.byCode.get(code)?.id));
  const card = (plan, input, loaded, code) => {
    const term = where(plan, code);
    const audit = auditUgaBoard({ board: plan, context: input.context, undergraduate: loaded, priorCodes: [], extraCredits: 0, transcript: null, dualLevel: data.dualLevelCourses, validation: { minimumTermCredits: 12, priorCredits: 0 } });
    return audit.issues.filter((i) => term && i.id === `ap-offering-${term.id}-${data.byCode.get(code).id}`);
  };
  for (const [program, code] of [[design, 'ARID 4010'], [geology, 'GEOL 4270']]) {
    const { input, loaded } = inputFor(program);
    const generated = generatePlan(input);
    const term = where(generated.plan, code);
    const flags = card(generated.plan, input, loaded, code);
    check(`${program.name}, no summer: ${code} stays on the board (${term?.label ?? 'off'}), not among the classes left off`, Boolean(term) && term.season !== 'Summer' && !generated.notPlaced.some((n) => n.code === code), generated.notPlaced.map((n) => n.code).join(', '));
    check(`and its card says the degree requires it, it is offered in summer only, and to use Add a summer`, flags.length === 1 && flags[0].message.startsWith(`Your degree requires ${code}, and the UGA Bulletin lists it for summer only. This plan has no summer`) && /Use Add a summer/.test(flags[0].message), flags.map((i) => i.message).join(' | '));
  }
  {
    const { input } = inputFor(design, { summers: [2027, 2028, 2029] });
    const plan = generatePlan(input).plan;
    check('Interior Design with summers 2027 to 2029: ARID 4010 goes in a summer', where(plan, 'ARID 4010')?.season === 'Summer', where(plan, 'ARID 4010')?.label ?? 'off');
    check('and its summers keep the summer rules', summerFaults(plan).length === 0, summerFaults(plan).join('; '));
  }
  {
    const { input, loaded } = inputFor(design, { summers: [2027] });
    const generated = generatePlan(input);
    const term = where(generated.plan, 'ARID 4010');
    const flags = card(generated.plan, input, loaded, 'ARID 4010');
    check('with only Summer 2027, too early for it: ARID 4010 stays in a fall or spring, and its card says none of the plan\'s summers can take it yet and names Summer 2029, the first after its prerequisites', Boolean(term) && term.season !== 'Summer' && flags.length === 1 && /None of this plan's summers can take it yet/.test(flags[0].message) && /Use Add a summer to plan Summer 2029 for it \(the first summer after ARID \d{4}, in (?:Spring|Fall) 20\d\d\)/.test(flags[0].message), `${term?.label ?? 'off'}: ${flags.map((i) => i.message).join(' | ')}`);
    // The advice works: Summer 2029 added beside 2027, and ARID 4010 goes there.
    const { input: followed } = inputFor(design, { summers: [2027, 2029] });
    check('and following it (Summer 2029 added) puts ARID 4010 in Summer 2029', where(generatePlan(followed).plan, 'ARID 4010')?.label === 'Summer 2029', where(generatePlan(followed).plan, 'ARID 4010')?.label ?? 'off');
  }
  {
    // One the board cannot hold for another reason is listed off it, as before, and the list says where it fits.
    const forestry = data.programs.find((p) => p.id === '61717');
    const { input } = inputFor(forestry);
    const off = generatePlan(input).notPlaced.find((n) => n.code === 'FORS 4650');
    check('Forestry BSFR, no summer: FORS 4650, left off for its prerequisites, is listed with "for summer only" and Add a summer', Boolean(off) && /The UGA Bulletin lists FORS 4650 for summer only, and your degree requires it: use Add a summer to plan a summer for it/.test(off.message), off?.message ?? 'placed');
  }
}

// ---------------------------------------------------------------------------
section("4d. Today's boards (a Spring 2027 start): the card's advice is one the board can follow (2026-10-22)");
/*
 * A freshman in October 2026 plans from Spring 2027. Art BFA - Interior
 * Design's ARID 4010 needs ARID 3125 and ARID 3420, and ARID 3125 needs ARID
 * 3110 and ARID 2110, each a fall course, so the first summer it can run is
 * Summer 2030, after a Spring 2030 finish. The card said "Use Add a summer to
 * plan a later summer" while Add a summer offered none, every summer inside
 * the plan already on the board. And Environmental Economics and
 * Management's WASR 4700L, required and summer only, lost Summer 2028's seat
 * to general education picks and was left off "to plan a later summer".
 */
{
  const { auditUgaBoard } = await import(join(ROOT, 'components/planner/uga-board-audit.ts'));
  const today = (program, summers) => {
    const { input, loaded } = inputFor(program, { summers });
    return { input: { ...input, horizon: { ...input.horizon, startSeason: 'Spring', startYear: 2027 } }, loaded };
  };
  const where = (plan, code) => plan.terms.find((t) => t.courseIds.includes(data.byCode.get(code)?.id));
  const design = data.programs.find((p) => p.id === '40512');
  for (const summers of [[2027, 2028, 2029], []]) {
    const { input, loaded } = today(design, summers);
    const plan = ST.withAddedSummers(generatePlan(input).plan, { ...S.NO_SHAPE, summers });
    const term = where(plan, 'ARID 4010');
    const audit = auditUgaBoard({ board: plan, context: input.context, undergraduate: loaded, priorCodes: [], extraCredits: 0, transcript: null, dualLevel: data.dualLevelCourses, validation: { minimumTermCredits: 12, priorCredits: 0 } });
    const flags = audit.issues.filter((i) => term && i.id === `ap-offering-${term.id}-${data.byCode.get('ARID 4010').id}`);
    const message = flags[0]?.message ?? '';
    const canAdd = ST.summersToAdd(plan);
    check(`Interior Design, Spring 2027 to Spring 2030, summers ${summers.join(', ') || 'none'}: ARID 4010 stays on the board (${term?.label ?? 'off'}), and its card says Summer 2030 is the first summer it can run, after the plan's last term, with no "Use Add a summer"`, Boolean(term) && term.season !== 'Summer' && flags.length === 1 && /the first summer it can run is Summer 2030, after this plan's last term \(Spring 2030\), where Add a summer cannot place it/.test(message) && !/Use Add a summer/.test(message) && /Ask your advisor/.test(message), message);
    check(`and the card never points to a summer the Add a summer menu could add for it (the menu offers ${canAdd.map((y) => `Summer ${y}`).join(', ') || 'none'})`, !canAdd.some((y) => message.includes(`Summer ${y}`)), message);
  }
  const economics = data.programs.find((p) => p.id === '66704');
  check('the premise: Environmental Economics and Management requires WASR 4700L, listed for summer only', SO.summerOnlyListed(data.byCode.get('WASR 4700L')));
  for (const summers of [[2028], [2027]]) {
    const { input } = today(economics, summers);
    const generated = generatePlan(input);
    const term = where(generated.plan, 'WASR 4700L');
    check(`Environmental Economics and Management, Spring 2027 start, Summer ${summers[0]} on the board: WASR 4700L takes a seat in it, ahead of the general education picks`, term?.label === `Summer ${summers[0]}` && !generated.notPlaced.some((n) => n.code === 'WASR 4700L') && summerFaults(generated.plan).length === 0, `${term?.label ?? 'off'}; ${summerFaults(generated.plan).join('; ')}`);
  }
}

// ---------------------------------------------------------------------------
section('4e. A summer-only pick in a fall or spring is traded in its own seat; nothing else on the board moves (2026-10-22)');
/*
 * Built again with the listing in force, a board moved more than the one
 * class: a Plant Biology junior's ARHI 2300, a fall-only World Languages pick
 * in place of ARHI 2121, took the last fall's seat from BINF 4550, which the
 * emphasis requires. Now the board as it was built before stands, with each
 * summer-only pick traded for a course of the same rows and hours that runs
 * in that term, where one keeps everything the gate measures.
 */
{
  const { auditUgaBoard } = await import(join(ROOT, 'components/planner/uga-board-audit.ts'));
  const listed = (code) => SO.summerOnlyListed(data.byCode.get(code));
  const aside = { ...data.context, offeringPublished: new Set([...data.context.offeringPublished].filter((code) => !listed(code))) };
  const codesOf = (plan) => plan.terms.map((t) => t.courseIds.map((id) => byId.get(id)?.code).filter(Boolean));
  const traded = [];
  const moved = [];
  const worse = [];
  const sample = [...['62409', '73962', '81139', '17378', '51649', '70392'].map((id) => data.programs.find((p) => p.id === id)), ...['Psychology BS', 'Finance BBA', 'Journalism AB'].map((name) => data.programs.find((p) => p.name === name))].filter(Boolean);
  const booksSummerOnly = [];
  for (const program of sample) {
    const { input, loaded } = inputFor(program);
    const planned = { ...input, horizon: { ...input.horizon, startSeason: 'Spring', startYear: 2027 } };
    // With the free choices' reading (autoplan.ts freeChoicesGated) the planner books none in a fall or spring either.
    const gated = generatePlan(planned).plan;
    const gatedOff = codesOf(gated).flatMap((codes, i) => (gated.terms[i].season === 'Summer' ? [] : codes.filter(listed)));
    if (gatedOff.length > 0) booksSummerOnly.push(`${program.name}: ${gatedOff.join(', ')}`);
    // The trade is checked on the picks as they were made when it was written: without the free choices' reading and
    // the Schedule of Classes (freeChoices 'off', no schedule), which book no summer-only pick on seven of these boards.
    const today = { ...planned, freeChoices: 'off', context: { ...planned.context, scheduled: undefined } };
    const before = generatePlan({ ...today, context: { ...today.context, offeringPublished: aside.offeringPublished } });
    const now = generatePlan(today);
    const was = codesOf(before.plan);
    const is = codesOf(now.plan);
    const off = was.flatMap((codes, i) => codes.filter((c) => listed(c) && before.plan.terms[i].season !== 'Summer'));
    if (off.length === 0) continue;
    const audit = (plan) => auditUgaBoard({ board: plan, context: today.context, undergraduate: loaded, priorCodes: [], extraCredits: 0, transcript: null, dualLevel: data.dualLevelCourses, validation: { minimumTermCredits: 12, priorCredits: 0 } }).areas.filter((row) => !row.satisfied).length;
    // The owner's count: more rows unmet, or as many with more classes left off (a board meeting more may leave more off).
    if (audit(now.plan) > audit(before.plan) || (audit(now.plan) === audit(before.plan) && now.notPlaced.length > before.notPlaced.length)) worse.push(`${program.name}: unmet rows ${audit(before.plan)} -> ${audit(now.plan)}, left off ${before.notPlaced.length} -> ${now.notPlaced.length}`);
    const stayed = was.every((codes, i) => codes.filter((c) => !listed(c)).every((c) => is[i]?.includes(c)));
    const added = is.flat().filter((c) => !was.flat().includes(c));
    if (stayed && added.length === off.length) traded.push(`${program.name}: ${off.join(', ')} -> ${added.join(', ')}`);
    else moved.push(`${program.name} (${off.join(', ')})`);
    if (is.some((codes, i) => now.plan.terms[i].season !== 'Summer' && codes.some(listed))) worse.push(`${program.name} still books ${is.flat().filter(listed).join(', ')} in a fall or spring`);
  }
  console.log(`        traded in place: ${traded.join('; ') || 'none'}`);
  console.log(`        built again (no trade kept everything): ${moved.join('; ') || 'none'}`);
  // Fisheries and Wildlife's WILD 1100E has one other course in its row, WILD 3000W, and no term with room for it: built again.
  check(`freshmen of ${sample.length} degrees: every board that booked a summer-only pick but Fisheries and Wildlife's is traded in place, everything else in its term (${traded.length} traded)`, sample.length === 9 && traded.length >= 7 && moved.every((line) => line.startsWith('Fisheries and Wildlife')), moved.join('; '));
  check('and with the free choices\' reading the planner books none of them in a fall or spring', booksSummerOnly.length === 0, booksSummerOnly.join('; '));
  check('and none meets fewer requirement rows, leaves more classes off, or keeps a summer-only pick in a fall or spring', worse.length === 0, worse.join(' | '));
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
