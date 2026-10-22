/**
 * Summers added and taken off by hand, at both schools (summer-terms.ts).
 *
 * Before 2026-10-20 a summer column came only from the setup words or a
 * summer finish: there was no button for one, ARCH (UGA) could not add one,
 * and ALMA could add one only by moving a course into it, which the next
 * Rebuild forgot. Now the board bar's "Add a summer" menu, the column's
 * remove button and the add_summer / remove_summer tools share one
 * implementation. This check builds real boards the way the browser does
 * (Illinois over public/illinois/*, UGA through uga-source.tsx over
 * public/uga-*) and fails when:
 *
 *   1. adding a summer moves, removes or rebuilds anything, puts the column
 *      out of calendar order, or accepts a summer outside the plan; removing
 *      an empty one does not give the old board back; removing one with
 *      classes keeps them or their instructor choice; the finish summer can
 *      be removed;
 *   2. the same at UGA, where Rebuild must keep the summer and fill it only
 *      by the summer rules (since 2026-10-22: only classes the UGA Bulletin
 *      lists for summer, at most 9 credits; __uga-summer.check.mjs checks
 *      them over every program), and on a Double Dawgs board, where Rebuild
 *      must keep the summer between the bachelor's finish and the master's
 *      start that neither of its two builds plans;
 *   3. the summers do not survive the saved-board parser, or an old save
 *      without droppedSummers stops loading;
 *   4. a summer the setup words asked for comes back on Rebuild after the
 *      student removed it, or does not come back once they add it again;
 *   5. Rebuild at Illinois drops an added summer, or fills it against the
 *      summer rules (only courses run in summer, at most 9 credits); or a
 *      summer added by hand stops set_plan_shape moving the finish before
 *      it, where it should come off with the move instead;
 *   6. a plan with no summer added or removed is not exactly what it was;
 *   7. ALMA or ARCH is missing either tool, the screen does not run them, or
 *      ARCH's prompt still says summers cannot be set from the chat (ARCH has
 *      set_plan_shape too since 2026-10-22).
 *
 *   node lib/planner/__summer-terms.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
// Extensionless and '@/' imports, and uga-source.tsx transpiled, as __uga-integration.check.mjs loads it.
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

const ST = await import(join(HERE, 'summer-terms.ts'));
const S = await import(join(HERE, 'saved-board.ts'));
const A = await import(join(HERE, 'advisor.ts'));
const AR = await import(join(HERE, 'advisor-request.ts'));
const { generatePlan } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { DEFAULT_PRIORITIES } = await import(join(HERE, 'priorities.ts'));
const G = await import(join(HERE, 'uga-planning-guidance.ts'));
const D = await import(join(HERE, 'double-dawgs.ts'));

/**
 * readHorizon is in a .tsx file next to React. Its section needs only its own
 * regexes, so it is cut out and loaded alone, as __horizon.check.mjs does.
 */
const illinoisSource = readFileSync(join(ROOT, 'components/planner/illinois-source.tsx'), 'utf8');
const cutFrom = illinoisSource.indexOf("/**\n * A term in a student's own words");
const cutTo = illinoisSource.indexOf('// ---------------------------------------------------------------------------\n// Course detail');
if (cutFrom < 0 || cutTo < 0) throw new Error('readHorizon section markers moved in illinois-source.tsx');
const cut = join(mkdtempSync(join(tmpdir(), 'summer-check-')), 'horizon.ts');
writeFileSync(cut, "type SemesterSeason = 'Fall' | 'Spring' | 'Summer';\ntype AwayKind = 'study_abroad' | 'co_op' | 'internship' | 'gap';\n" + illinoisSource.slice(cutFrom, cutTo));
const { readHorizon } = await import(pathToFileURL(cut).href);

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) { passes += 1; console.log(`  ok    ${name}`); return; }
  failures += 1;
  console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
}
const section = (title) => console.log(`\n${title}`);
const json = (v) => JSON.stringify(v);
const labels = (board) => board.terms.map((t) => t.label);
const withoutSummer = (board, year) => board.terms.filter((t) => !(t.season === 'Summer' && t.label === `Summer ${year}`));

// --- Illinois, as the browser loads it ---------------------------------------
const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const meta = read('illinois/meta.json');
const rows = read('illinois/index.json').map(hydrateIndexRow);
const offeringsFile = existsSync(join(PUBLIC, 'illinois', 'offerings.json')) ? read('illinois/offerings.json') : null;
if (offeringsFile) applyOfferings(rows, offeringsFile);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const gradeRaw = new Map(read('illinois/grades.json').map((g) => [norm(g.code), g]));
for (const c of rows) if (c.gradeFrom) { const g = gradeRaw.get(norm(c.gradeFrom)); if (g) gradeRaw.set(norm(c.code), g); }
const grades = new Map(); for (const [code, g] of gradeRaw) grades.set(code, toGradeRow(g, byCode.get(code)?.title ?? code, []));
const equivalents = new Map(); for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map(); for (const c of rows) { const max = c.creditsMax ?? c.credits; creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true }); }
const languagesFile = existsSync(join(PUBLIC, 'illinois', 'languages.json')) ? read('illinois/languages.json') : null;
const context = {
  courses: rows, prereqs: new Map(Object.entries(read('illinois/prereqs.json'))), grades, sections: new Map(), equivalents,
  exclusions: new Map(Object.entries(read('illinois/exclusions.json'))), creditRanges, bands: meta.bands,
  offeringPublished: offeringsFile ? new Set(rows.map((c) => norm(c.code))) : new Set(),
  offerings: offeringsFile ? new Map(Object.entries(offeringsFile.courses)) : undefined, offeringTerms: offeringsFile?.terms,
  languages: languagesFile ?? undefined, snapshotTerm: null,
  prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
};
const summaries = read('illinois/programs.json');
const PSYC = 'las/psychology-bslas';
const psycSummary = summaries.find((p) => p.id === PSYC);
const psycBlocks = adaptIllinoisPrograms({ school: 'illinois', source: psycSummary.url, fetchedAt: '', programs: [read(`illinois/program/${PSYC}.json`)] }, new Map(byCode)).blocks.get(PSYC) ?? [];
const FRESH = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish' };
const H = (extra = {}) => ({ startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true, ...extra });
/** A Psychology board the way the workspace asks for one. */
const illinoisPlan = (horizon) => generatePlan({
  requirements: psycBlocks, context, prior: FRESH, horizon, preferences: { creditsPerTerm: { min: 12, target: null, max: 18 } },
  programId: PSYC, degreeTotal: psycSummary.totalCredits || 120, interests: 'Psychology.', programName: psycSummary.name, programCollege: psycSummary.college,
});
const courseById = new Map(rows.map((c) => [c.id, c]));

// ---------------------------------------------------------------------------
section('1. Illinois: adding and removing a summer with the shared functions');
const base = illinoisPlan(H()).plan;
{
  check('the Psychology board starts with no summer', !base.terms.some((t) => t.season === 'Summer'), labels(base).join(', '));
  check('the summers it can take are 2027, 2028 and 2029 (none before Fall 2026 or after Spring 2030)', json(ST.summersToAdd(base)) === json([2027, 2028, 2029]), json(ST.summersToAdd(base)));
  for (const [raw, want] of [['Summer 2027', 2027], ['summer of 2027', 2027], [2027, 2027], ['2027', 2027], ['  SUMMER 2028 ', 2028], ['Fall 2027', null], ['', null], [null, null], ['Summer 27', null]]) {
    check(`summerYearOf(${json(raw)}) is ${want}`, ST.summerYearOf(raw) === want, String(ST.summerYearOf(raw)));
  }
  const added = ST.addSummer(base, S.NO_SHAPE, 2028);
  check('Summer 2028 is added', added.ok, added.reason);
  if (added.ok) {
    const at = added.board.terms.findIndex((t) => t.id === added.term.id);
    check('it sits between Spring 2028 and Fall 2028', added.board.terms[at - 1]?.label === 'Spring 2028' && added.board.terms[at + 1]?.label === 'Fall 2028', labels(added.board).join(', '));
    check('it is empty, labelled "Summer 2028", with the id the engine gives a summer', added.term.courseIds.length === 0 && added.term.label === 'Summer 2028' && added.term.id === 'summer-2028' && added.term.season === 'Summer');
    check("it belongs to Spring 2028's year of the plan, so the year ruler is right", added.term.year === added.board.terms[at - 1].year);
    check('every other term is exactly as it was: nothing moved, removed or rebuilt', json(withoutSummer(added.board, 2028)) === json(base.terms));
    check('the rest of the board is untouched', json({ ...added.board, terms: [] }) === json({ ...base, terms: [] }));
    check('the plan shape now has summers [2028] and nothing dropped', json(added.shape.summers) === json([2028]) && json(added.shape.droppedSummers) === json([]));
    check('the board bar now offers 2027 and 2029', json(ST.summersToAdd(added.board)) === json([2027, 2029]));
    check('the shape the board started from is not changed in place', json(S.NO_SHAPE) === json({ finish: null, away: [], summers: [], spreadHard: false, droppedSummers: [] }));
    const again = ST.addSummer(added.board, added.shape, 2028);
    check('adding Summer 2028 again is refused', !again.ok && /already on the board/.test(again.reason), again.reason);
    const removed = ST.removeSummer(added.board, added.shape, 2028);
    check('removing the empty Summer 2028 gives the old board back exactly', removed.ok && json(removed.board) === json(base), removed.reason);
    check('and records it as dropped, off the summers', removed.ok && json(removed.shape.summers) === json([]) && json(removed.shape.droppedSummers) === json([2028]));
    check('removed: the change says which term went and that no class went with it', removed.ok && removed.term.id === 'summer-2028' && removed.removedCourseIds.length === 0);
  }
  for (const [year, why] of [[2026, 'before the plan starts'], [2030, 'after it ends'], [2033, 'years past it']]) {
    const r = ST.addSummer(base, S.NO_SHAPE, year);
    check(`Summer ${year} is refused (${why})`, !r.ok && /outside this plan, which runs Fall 2026 to Spring 2030/.test(r.reason), r.reason);
  }
  // A summer with a class in it, and the instructor the student chose for it.
  if (added.ok) {
    const fall = added.board.terms.find((t) => t.label === 'Fall 2028');
    const moving = fall.courseIds[0];
    const code = courseById.get(moving)?.code;
    const held = {
      ...added.board,
      terms: added.board.terms.map((t) => (t.id === 'summer-2028' ? { ...t, courseIds: [moving] } : t.id === fall.id ? { ...t, courseIds: t.courseIds.slice(1) } : t)),
      instructors: { 'summer-2028': { [code]: 'A. Teacher' }, [fall.id]: { X: 'B. Teacher' } },
    };
    const r = ST.removeSummer(held, added.shape, 2028);
    check(`removing Summer 2028 with ${code} in it takes ${code} off the plan`, r.ok && json(r.removedCourseIds) === json([moving]) && !r.board.terms.some((t) => t.courseIds.includes(moving)), r.reason);
    check('its instructor choice goes with it, and no other term\'s', r.ok && r.board.instructors && !('summer-2028' in r.board.instructors) && r.board.instructors[fall.id]?.X === 'B. Teacher');
    check('no other term changes', r.ok && json(r.board.terms) === json(held.terms.filter((t) => t.id !== 'summer-2028')));
  }
  const none = ST.removeSummer(base, S.NO_SHAPE, 2027);
  check('removing a summer the board does not have is refused, saying so', !none.ok && /No Summer 2027 is on the board; it has no summers/.test(none.reason), none.reason);
  const finishing = illinoisPlan(H({ gradSeason: 'Summer', gradYear: 2029, summers: [2029] })).plan;
  const last = finishing.terms[finishing.terms.length - 1];
  const r = ST.removeSummer(finishing, S.NO_SHAPE, 2029);
  check('a Summer 2029 finish is the last term, and it cannot be removed on its own', last.label === 'Summer 2029' && !ST.summerRemovable(finishing, last.id) && !r.ok && /last term, its finish/.test(r.reason), r.reason);
}

// ---------------------------------------------------------------------------
section('2. UGA: the same functions on a UGA board; Rebuild keeps the summer and fills it by the summer rules');
{
  const publicJson = (name) => JSON.parse(readFileSync(join(PUBLIC, name), 'utf8'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify(publicJson((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
  const U = await import(join(ROOT, 'components/planner/uga-source.tsx'));
  const data = await U.loadUgaData();
  globalThis.fetch = originalFetch;
  const program = data.programs.find((p) => p.name.toLowerCase().includes('psychology') && p.degree.toLowerCase() === 'bs');
  const emphasisSelections = Object.fromEntries(U.ugaSelectionRequirements(program).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
  const loaded = U.loadUgaProgram(data, program, { emphasisSelections });
  const ugaContext = { ...data.context, samplePlanCourses: G.sampleCoursesFor(G.samplePlansFor(data.guidance, [program.id])) };
  const ugaPlan = (summers) => generatePlan({
    requirements: loaded.blocks, context: ugaContext, programName: loaded.program.name, programId: program.id,
    prior: { known: true, courseCodes: [], exemptCodes: [], unmatchedCredits: 0 },
    horizon: { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true, summers },
    degreeTotal: program.totalCredits, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
    preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 }, priorities: DEFAULT_PRIORITIES },
  });
  const summerCourses = data.courses.filter((c) => c.offeredIn.includes('Summer')).length;
  check(`the premise: UGA's catalog lists ${summerCourses} courses offered in summer (none before 2026-10-22)`, summerCourses > 3000);
  const ugaBase = ugaPlan([]).plan;
  check(`a UGA ${program.name} board, Fall 2026 to Spring 2030, with no summer`, ugaBase.terms.length === 8 && !ugaBase.terms.some((t) => t.season === 'Summer'), labels(ugaBase).join(', '));
  check('the summers it can take are 2027, 2028 and 2029', json(ST.summersToAdd(ugaBase)) === json([2027, 2028, 2029]));
  const added = ST.addSummer(ugaBase, S.NO_SHAPE, 2027);
  check('Summer 2027 is added at UGA, empty, between Spring 2027 and Fall 2027', added.ok && added.term.courseIds.length === 0 && json(labels(added.board).slice(1, 4)) === json(['Spring 2027', 'Summer 2027', 'Fall 2027']), added.ok ? labels(added.board).join(', ') : added.reason);
  check('nothing else on the UGA board moved', added.ok && json(withoutSummer(added.board, 2027)) === json(ugaBase.terms));
  if (added.ok) {
    const rebuilt = ugaPlan(ST.summersFor([], added.shape)).plan;
    const summer = rebuilt.terms.find((t) => t.label === 'Summer 2027');
    check('Rebuild at UGA keeps Summer 2027', Boolean(summer), labels(rebuilt).join(', '));
    const held = (summer?.courseIds ?? []).map((id) => data.courses.find((c) => c.id === id));
    const credits = held.reduce((n, c) => n + (c?.credits ?? 0), 0);
    console.log(`        UGA Summer 2027 after Rebuild: ${held.map((c) => c?.code).join(', ') || 'empty'} (${credits} credits)`);
    check('and fills it only with classes the UGA Bulletin lists for summer (Summer 2027 is an odd year), at most 9 credits', held.length > 0 && held.every((c) => c && c.offeredIn.includes('Summer') && c.summerYears !== 'even') && credits <= 9, held.map((c) => `${c?.code} ${c?.offeredIn}`).join('; '));
    const removed = ST.removeSummer(added.board, added.shape, 2027);
    check('removing it at UGA gives the old board back', removed.ok && json(removed.board) === json(ugaBase));
  }
  const src = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  check('an empty UGA summer column shows the plain line, and no other column does', src.includes("const UGA_SUMMER_NOTE = 'Rebuild fills this summer with classes the UGA Bulletin lists for summer, up to 9 credits. Or add classes yourself.';") && /note=\{isUga && term\.season === 'Summer' && term\.courseIds\.length === 0 \? UGA_SUMMER_NOTE : null\}/.test(src));

  /**
   * A Double Dawgs board is two builds: the bachelor's to its finish and the
   * master's from the fall or spring after it. The menu offered the summer
   * between them, but Rebuild dropped it, the shape still listed it (ARCH's
   * board description kept saying "summer classes in 2031" with no such
   * column) and remove_summer said it was not on the board.
   */
  section("2b. Double Dawgs: a summer between the bachelor's and the master's stays through Rebuild");
  const pathway = data.guidance.pathways.find((p) => p.id === '17003');
  const ddProgram = data.programs.find((p) => p.id === pathway.undergraduateProgramIds[0]);
  const ddSelections = Object.fromEntries(U.ugaSelectionRequirements(ddProgram).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
  const undergraduate = U.loadUgaProgram(data, ddProgram, { emphasisSelections: ddSelections });
  const graduate = D.withDoubleDawgsGraduateRules(U.loadUgaProgram(data, data.programs.find((p) => p.id === pathway.graduateProgramIds[0]), { resetRequirements: false }), data.context);
  const shared = D.selectSharedCourses(pathway, D.doubleDawgsOptions(pathway, undergraduate, graduate, data.byCode, data.dualLevelCourses));
  /** The board the workspace's Rebuild makes: the two builds, then the summers the student added put back. */
  const ddBuild = (finish, shape) => ST.withAddedSummers(D.generateDoubleDawgs({
    undergraduate: {
      requirements: undergraduate.blocks, context: data.context, programName: ddProgram.name, programId: ddProgram.id,
      prior: { known: true, courseCodes: ['ENGL 1101'], exemptCodes: [], unmatchedCredits: 0 },
      horizon: { startSeason: 'Fall', startYear: 2027, gradSeason: finish, gradYear: 2031, stated: true, summers: ST.summersFor([], shape) },
      degreeTotal: ddProgram.totalCredits, electiveHoursLimit: undergraduate.electiveHours, fillToDegreeTotal: undergraduate.fillToDegreeTotal,
      preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 }, priorities: DEFAULT_PRIORITIES },
    },
    undergraduateProgram: undergraduate.program, graduate, pathway, shared, graduateFinish: { season: 'Spring', year: 2032 },
  }).plan, shape);
  for (const finish of ['Spring', 'Summer']) {
    const ddBase = ddBuild(finish, S.NO_SHAPE);
    const name = `${pathway.name}, bachelor's by ${finish} 2031, master's by Spring 2032`;
    if (finish === 'Summer') {
      // Since 2026-10-22 a UGA summer can hold classes, so a bachelor's
      // finish in Summer 2031 is that summer, built like any other: before,
      // nothing could go in it and the board ended in Spring 2031.
      const last = ST.summerOn(ddBase, 2031);
      const held = (last?.courseIds ?? []).map((id) => data.courses.find((c) => c.id === id));
      const credits = held.reduce((n, c) => n + (c?.credits ?? 0), 0);
      console.log(`        ${name}: Summer 2031 holds ${held.map((c) => c?.code).join(', ') || 'nothing'} (${credits} credits)`);
      check(`${name}: Summer 2031 is the bachelor's last term, with classes the UGA Bulletin lists for summer, at most 9 credits`, Boolean(last) && held.length > 0 && held.every((c) => c && c.offeredIn.includes('Summer') && c.summerYears !== 'even') && credits <= 9 && ddBase.doubleDawgs?.undergraduateFinish?.season === 'Summer', labels(ddBase).join(', '));
      check(`${finish} finish: Rebuild gives the same board`, json(ddBuild(finish, S.NO_SHAPE)) === json(ddBase));
      continue;
    }
    check(`${name}: no summer, and the menu offers Summer 2031 between the two`, !ddBase.terms.some((t) => t.season === 'Summer') && ST.summersToAdd(ddBase).includes(2031), `${labels(ddBase).join(', ')}; offers ${json(ST.summersToAdd(ddBase))}`);
    const added = ST.addSummer(ddBase, S.NO_SHAPE, 2031);
    check(`${finish} finish: Summer 2031 is added between Spring 2031 and Fall 2031`, added.ok && json(labels(added.board).slice(7, 10)) === json(['Spring 2031', 'Summer 2031', 'Fall 2031']), added.ok ? labels(added.board).join(', ') : added.reason);
    if (!added.ok) continue;
    const rebuilt = ddBuild(finish, added.shape);
    const summer = ST.summerOn(rebuilt, 2031);
    check(`${finish} finish: Rebuild keeps Summer 2031, empty, as it was added`, summer && json(summer) === json(added.term), summer ? json(summer) : labels(rebuilt).join(', '));
    check(`${finish} finish: every summer the plan shape lists is on the rebuilt board`, added.shape.summers.every((y) => ST.summerOn(rebuilt, y)), `${json(added.shape.summers)} vs ${labels(rebuilt).join(', ')}`);
    check(`${finish} finish: nothing else on the rebuilt board changed`, json(rebuilt) === json(added.board));
    const removed = ST.removeSummer(rebuilt, added.shape, 2031);
    check(`${finish} finish: remove_summer can take it off after Rebuild, and the next Rebuild leaves it off`, removed.ok && json(removed.board) === json(ddBase) && json(ddBuild(finish, removed.shape)) === json(ddBase), removed.reason);
  }
  check('a board missing no added summer is the same board, not a copy', ST.withAddedSummers(ugaBase, S.NO_SHAPE) === ugaBase && ST.withAddedSummers(ugaBase, { ...S.NO_SHAPE, summers: [2031, 2026] }) === ugaBase);
  check("the workspace's Rebuild puts the added summers back on the board it shows", /const keptSummers = withAddedSummers\(generated\.plan, planShape\);\n\s+if \(keptSummers !== generated\.plan\) generated = \{ \.\.\.generated, plan: keptSummers \};\n(?:\s+\/\/[^\n]*\n)?\s+const codeOfId = /.test(src));
}

// ---------------------------------------------------------------------------
section('3. The saved board keeps the summers, and old saves still load');
{
  const added = ST.addSummer(base, { ...S.NO_SHAPE, droppedSummers: [2029] }, 2028);
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
  const board = { plan: added.board, report: null, notes: [], studentAdded: [], repickedFor: null, edited: true };
  const settings = { minimumTermCredits: 12, targetTermCredits: null, careerInterests: '', careerCleared: false, priorities: DEFAULT_PRIORITIES, planShape: added.shape };
  S.writeSavedBoard(storage, S.serializeBoard({ schemaVersion: 4, schoolId: 'illinois', programId: PSYC, savedAt: '', board, settings }));
  const back = S.readSavedBoard(storage, 'illinois');
  check('the board comes back with its Summer 2028 column', back && json(back.board.plan) === json(added.board), back ? labels(back.board.plan).join(', ') : 'nothing read');
  check('and the plan shape with summers [2028] and dropped [2029]', back && json(back.settings.planShape) === json({ finish: null, away: [], summers: [2028], spreadHard: false, droppedSummers: [2029] }), back ? json(back.settings.planShape) : '');
  // A save written before droppedSummers existed.
  const old = JSON.parse(map.get(S.BOARD_KEY));
  delete old.settings.planShape.droppedSummers;
  map.set(S.BOARD_KEY, JSON.stringify(old));
  const oldBack = S.readSavedBoard(storage, 'illinois');
  check('an old save without droppedSummers still loads, with its summers, and none dropped', oldBack && json(oldBack.settings.planShape.summers) === json([2028]) && json(oldBack.settings.planShape.droppedSummers) === json([]) && json(oldBack.board.plan) === json(added.board));
  check('a broken droppedSummers keeps only the years', json(S.readShape({ summers: [2027], droppedSummers: ['2028', 2029.5, 2030, null] }).droppedSummers) === json([2030]));
  check('no shape at all reads as no shape', json(S.readShape(undefined)) === json(S.NO_SHAPE) && json(S.readShape({})) === json(S.NO_SHAPE));
  const legacy = S.migrateLegacyBoard(JSON.stringify({ schemaVersion: 3, schoolId: 'illinois', plan: base, planShape: { summers: [2027] } }), 'illinois');
  check('a v3 entry moves to v4 with its summers and none dropped', legacy && json(legacy.settings.planShape.summers) === json([2027]) && json(legacy.settings.planShape.droppedSummers) === json([]));
  const src = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  check('a download and a share link carry the plan shape, and opening a file reads it back', /planShape: planShapeRef\.current,\n\s+\}, null, 2\)\]/.test(src) && /plan,\n\s+planShape: planShapeRef\.current,\n\s+\}\)\)\);/.test(src) && /const shape = parsed\.planShape !== undefined \? readShape\(parsed\.planShape\) : null;/.test(src));
  check("undo of the student's own summer change puts the shape back too", /shapeBefore\?: PlanShape/.test(src) && /if \(entry\.planShape\) \{\n\s+planShapeRef\.current = entry\.planShape;/.test(src));
}

// ---------------------------------------------------------------------------
section('4. A summer from the setup words stays off once the student removes it');
{
  const words = 'Starting fall 2026, four years including summers.';
  const said = readHorizon(words, { season: 'Fall', year: 2026 }).summers;
  check(`"${words}" asks for summers 2027, 2028 and 2029`, json(said) === json([2027, 2028, 2029]), json(said));
  const built = illinoisPlan(H({ summers: ST.summersFor(said, S.NO_SHAPE) })).plan;
  check('the board built from them has the three summers', json(built.terms.filter((t) => t.season === 'Summer').map((t) => t.label)) === json(['Summer 2027', 'Summer 2028', 'Summer 2029']));
  const removed = ST.removeSummer(built, S.NO_SHAPE, 2028);
  check('the student removes Summer 2028', removed.ok && !labels(removed.board).includes('Summer 2028'), removed.reason);
  if (removed.ok) {
    check('the build now plans 2027 and 2029 only', json(ST.summersFor(said, removed.shape)) === json([2027, 2029]));
    const rebuilt = illinoisPlan(H({ summers: ST.summersFor(said, removed.shape) })).plan;
    check('Rebuild leaves Summer 2028 off, and keeps the other two', !labels(rebuilt).includes('Summer 2028') && labels(rebuilt).includes('Summer 2027') && labels(rebuilt).includes('Summer 2029'), labels(rebuilt).join(', '));
    const back = ST.addSummer(rebuilt, removed.shape, 2028);
    check('adding it again takes it off the dropped list, so Rebuild plans it again', back.ok && json(back.shape.droppedSummers) === json([]) && json(ST.summersFor(said, back.shape)) === json([2027, 2028, 2029]));
  }
  const src = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  // horizonFor moved to lib/planner/plan-start.ts (2026-10-20), so the checks can run it.
  const startSrc = readFileSync(join(ROOT, 'lib/planner/plan-start.ts'), 'utf8');
  const horizonFor = startSrc.slice(startSrc.indexOf('export function horizonFor('), startSrc.indexOf('/** Eight falls and springs from a term'));
  check("the workspace's horizonFor reads its summers through summersFor", /horizon\.summers = summersFor\(horizon\.summers \?\? \[\], shape\);/.test(horizonFor) && /import \{ horizonFor, stepRegular, termOrd \} from '@\/lib\/planner\/plan-start';/.test(src));
  check('set_plan_shape naming a dropped summer again takes it off the dropped list', /nextShape\.droppedSummers = \(nextShape\.droppedSummers \?\? \[\]\)\.filter\(\(y\) => !years\.includes\(y\)\);/.test(src));
}

// ---------------------------------------------------------------------------
section('5. Rebuild at Illinois keeps an added summer, filled only by the summer rules');
{
  const added = ST.addSummer(base, S.NO_SHAPE, 2027);
  const rebuilt = illinoisPlan(H({ summers: ST.summersFor([], added.shape) }));
  const summer = rebuilt.plan.terms.find((t) => t.label === 'Summer 2027');
  check('Rebuild keeps Summer 2027', Boolean(summer), labels(rebuilt.plan).join(', '));
  const codes = (summer?.courseIds ?? []).map((id) => courseById.get(id));
  const credits = codes.reduce((n, c) => n + (c?.credits ?? 0), 0);
  console.log(`        Summer 2027 after Rebuild: ${codes.map((c) => c?.code).join(', ') || 'empty'} (${credits} credits)`);
  check('every course the build put there has run in a summer', codes.every((c) => c?.offeredIn.includes('Summer')), codes.filter((c) => !c?.offeredIn.includes('Summer')).map((c) => c?.code).join(', '));
  check('and it holds at most 9 credits', credits <= 9, String(credits));
  check('the build kept it, so Rebuild puts nothing back on top: the same board', ST.withAddedSummers(rebuilt.plan, added.shape) === rebuilt.plan);
}

// ---------------------------------------------------------------------------
section('5b. A finish moved earlier takes an added summer past it off, instead of being refused');
{
  /**
   * set_plan_shape refused every summer in the shape outside the new range.
   * Once the menu and add_summer put years there too, "finish in Spring 2029"
   * after a Summer 2029 added by hand came back refused, and ALMA's way past
   * it was a summers list that replaced every summer the student had added.
   */
  const fall2026 = { season: 'Fall', year: 2026 };
  const spring2029 = { season: 'Spring', year: 2029 };
  const a = ST.addSummer(base, S.NO_SHAPE, 2027);
  const b = a.ok ? ST.addSummer(a.board, a.shape, 2029) : a;
  check('the student adds Summer 2027 and Summer 2029 by hand', b.ok && json(b.shape.summers) === json([2027, 2029]), b.reason);
  const finish = ST.summersInRange(b.shape.summers, false, fall2026, spring2029);
  check('finish in Spring 2029 is not refused over them', json(finish.refused) === json([]));
  check('Summer 2029, past it, comes off, for ALMA to tell the student; Summer 2027 stays', json(finish.off) === json([2029]) && json(finish.summers) === json([2027]), json(finish));
  const shape = { ...b.shape, finish: spring2029, summers: finish.summers };
  const rebuilt = ST.withAddedSummers(illinoisPlan(H({ gradYear: 2029, summers: ST.summersFor([], shape) })).plan, shape);
  check('the rebuilt board ends in Spring 2029 with Summer 2027 and no Summer 2029', labels(rebuilt).at(-1) === 'Spring 2029' && labels(rebuilt).includes('Summer 2027') && !labels(rebuilt).includes('Summer 2029'), labels(rebuilt).join(', '));
  check('every summer the shape lists is on that board', shape.summers.every((y) => ST.summerOn(rebuilt, y)));
  const named = ST.summersInRange([2029], true, fall2026, spring2029);
  check('a summer the call itself names past the finish is still refused', json(named.refused) === json([2029]) && json(named.off) === json([]) && json(named.summers) === json([2029]));
  check('a summer it names inside is kept', json(ST.summersInRange([2027, 2028], true, fall2026, spring2029)) === json({ summers: [2027, 2028], refused: [], off: [] }));
  check('a summer finish is no later than the finish', json(ST.summersInRange([2029], false, fall2026, { season: 'Summer', year: 2029 }).summers) === json([2029]));
  check('a summer before the first term is outside too', json(ST.summersInRange([2026, 2027], false, fall2026, spring2029)) === json({ summers: [2027], refused: [], off: [2026] }));
  const src = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  const handler = src.slice(src.indexOf("case 'set_plan_shape': {"), src.indexOf("case 'exam_credit': {"));
  check('set_plan_shape refuses only the summers the call names, and keeps the rest in range', /const inRange = summersInRange\(nextShape\.summers, Array\.isArray\(input\.summers\), /.test(handler) && /nextShape\.summers = inRange\.summers;/.test(handler) && !/for \(const y of nextShape\.summers\)/.test(handler));
  check('and says which summers came off, in the asking and in the result', (handler.match(/\.\.\.off,/g) ?? []).length === 3 && (handler.match(/\$\{offNote \? ` \$\{offNote\}` : ''\}/g) ?? []).length === 3);
}

// ---------------------------------------------------------------------------
section('6. A plan with no summer added or removed is exactly what it was');
{
  const old = (said, shape) => [...new Set([...said, ...shape.summers])];
  const cases = [[[], []], [[2027], []], [[2027, 2028, 2029], []], [[2029, 2027], [2028]], [[], [2028, 2027]], [[2028], [2028]]];
  const differ = cases.filter(([said, summers]) => json(ST.summersFor(said, { ...S.NO_SHAPE, summers })) !== json(old(said, { summers })));
  check('with nothing dropped, the summers a build plans are the old merge, item for item', differ.length === 0, json(differ));
  const shapeOfOldSave = S.readShape({ finish: null, away: [], summers: [2027], spreadHard: false });
  check('an old saved shape plans the summers it always did', json(ST.summersFor([2028], shapeOfOldSave)) === json([2028, 2027]));
  for (const summers of [[], [2027], [2027, 2028, 2029]]) {
    const before = illinoisPlan(H({ summers: old(summers, S.NO_SHAPE) })).plan;
    const after = illinoisPlan(H({ summers: ST.summersFor(summers, S.NO_SHAPE) })).plan;
    check(`Psychology with summers ${json(summers)}: the board is byte for byte the same`, json(before) === json(after));
    check(`Psychology with summers ${json(summers)}: Rebuild puts no summer back, the same board`, ST.withAddedSummers(after, S.NO_SHAPE) === after);
  }
}

// ---------------------------------------------------------------------------
section('7. Both assistants have add_summer and remove_summer, and the screen runs them');
{
  const alma = A.ADVISOR_TOOLS.map((t) => t.name);
  const arch = A.ugaAdvisorTools().map((t) => t.name);
  const at = alma.indexOf('move_course');
  check('ALMA has add_summer and remove_summer, after move_course', alma[at + 1] === 'add_summer' && alma[at + 2] === 'remove_summer', alma.join(', '));
  check('ARCH has both, in the same place', arch[arch.indexOf('move_course') + 1] === 'add_summer' && arch[arch.indexOf('move_course') + 2] === 'remove_summer' && A.UGA_TOOL_NAMES.has('add_summer') && A.UGA_TOOL_NAMES.has('remove_summer'), arch.join(', '));
  check('ARCH has set_plan_shape since 2026-10-22, so a UGA board can be rebuilt around summers from the chat', arch.includes('set_plan_shape') && A.UGA_TOOL_NAMES.has('set_plan_shape'));
  const ill = AR.advisorRequest({ model: 'claude-opus-5', bot: 'ALMA', schoolName: 'University of Illinois Urbana-Champaign', schoolShort: 'Illinois', board: 'x', messages: [{ role: 'user', content: 'add a summer' }], now: new Date('2026-10-20T15:00:00Z') });
  const uga = AR.advisorRequest({ model: 'claude-opus-5', bot: 'ARCH', schoolName: 'University of Georgia', schoolShort: 'UGA', board: 'x', messages: [{ role: 'user', content: 'add a summer' }], now: new Date('2026-10-20T15:00:00Z') });
  check('both requests send both tools to the model', ['add_summer', 'remove_summer'].every((n) => ill.tools.some((t) => t.name === n) && uga.tools.some((t) => t.name === n)));
  const remove = A.ADVISOR_TOOLS.find((t) => t.name === 'remove_summer');
  const add = A.ADVISOR_TOOLS.find((t) => t.name === 'add_summer');
  check('remove_summer takes the summer and confirmed; add_summer takes the summer', json(Object.keys(remove.input_schema.properties)) === json(['term', 'confirmed']) && json(Object.keys(add.input_schema.properties)) === json(['term']) && json(add.input_schema.properties.term.type) === json(['string', 'integer']));
  check('remove_summer says it asks first when the summer holds classes', /needs_confirmation naming them/.test(remove.description) && /confirmed true only after they say yes/.test(remove.description));
  check('add_summer says nothing is rebuilt and only on the student\'s ask or yes', /Nothing is rebuilt, moved or removed/.test(add.description) && /only when the student asks for a summer or says yes to one/.test(add.description));
  const archAdd = A.ugaAdvisorTools().find((t) => t.name === 'add_summer');
  check("ARCH's add_summer says a Rebuild fills it with classes the UGA Bulletin lists for summer, and names no Illinois", /a Rebuild fills it with classes the UGA Bulletin lists for summer, at most 9 credits/.test(archAdd.description) && !/not loaded/.test(archAdd.description) && !/Illinois/.test(archAdd.description));
  const src = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  const handler = (name) => src.slice(src.indexOf(`case '${name}': {`), src.indexOf("\n      case '", src.indexOf(`case '${name}': {`) + 10));
  check('the screen runs add_summer through addSummer, and returns the terms after it', /const change = addSummer\(board, planShapeRef\.current, year\);/.test(handler('add_summer')) && /terms: change\.board\.terms\.map\(\(t\) => t\.label\)/.test(handler('add_summer')));
  check('add_summer at UGA says how the summer fills: the classes the UGA Bulletin lists for summer, by hand or set_plan_shape summers', /add or move courses the UGA Bulletin lists for summer \(course_details says whether it lists one/.test(handler('add_summer')) && /set_plan_shape summers rebuilds the board around its summers with those courses, at most 9 credits a summer/.test(handler('add_summer')) && !/summer course list is not loaded/.test(handler('add_summer')));
  check('remove_summer asks for confirmed when the summer holds classes, naming them, before it changes anything', /needs_confirmation: true/.test(handler('remove_summer')) && handler('remove_summer').indexOf('needs_confirmation') < handler('remove_summer').indexOf('removeSummer(board'));
  check('remove_summer returns the terms after it and what came off', /removed_courses: codes/.test(handler('remove_summer')) && /terms: change\.board\.terms\.map/.test(handler('remove_summer')));
  check('the board bar has "Add a summer", and the summer column a remove button that asks first when it holds classes', /aria-label="Add a summer"/.test(src) && /<Plus aria-hidden="true" \/> <span className="add-summer-wide">Add a <\/span>summer/.test(src) && /onRemoveSummer=\{summerRemovable\(plan, term\.id\) \? askRemoveSummer : undefined\}/.test(src) && /setSummerToRemove\(\{ termId, label: term\.label, codes:/.test(src));
  const col = readFileSync(join(ROOT, 'components/planner/semester-column.tsx'), 'utf8');
  check('the column\'s remove button is a labelled button', /aria-label=\{`Remove \$\{term\.label\} from the plan`\}/.test(col));
  const chat = readFileSync(join(ROOT, 'components/planner/advisor.tsx'), 'utf8');
  check('the chat names both tools while they run', /case 'add_summer':\n\s+case 'remove_summer': \{/.test(chat));
  const route = readFileSync(join(ROOT, 'app/api/advisor/route.ts'), 'utf8');
  check('the advisor route lists no tool names of its own to keep these out', !/'move_course'|"move_course"/.test(route));
}

// ---------------------------------------------------------------------------
section("8. The prompts: ARCH can add and remove a summer and rebuild around one; ALMA knows add_summer from set_plan_shape");
{
  const ALMA = A.advisorSystem('ALMA', 'University of Illinois Urbana-Champaign', 'Illinois');
  const ARCH = A.advisorSystem('ARCH', 'University of Georgia', 'UGA');
  check("ARCH's prompt no longer says the load, the finish, terms away or summers cannot be set from the chat", !/cannot change these from the chat/i.test(ARCH) && /set_plan_shape changes credits per term, the finish, terms away and summers, and rebuilds the board/.test(ARCH));
  check('ARCH adds a summer on request and removes one, with a yes for one that holds classes', /add_summer puts an empty summer column on the board when the student asks for one/.test(ARCH) && /remove_summer takes one off \(one that holds classes only after you name them and the student says yes\)/.test(ARCH));
  check('ARCH says the planner fills a summer only with classes the UGA Bulletin lists, at most 9 credits, and never says a class runs in a summer unless course_details does', /The planner fills a summer only with classes the UGA Bulletin lists for summer \(a class listed for every other summer only in those years\), at most 9 credits/.test(ARCH) && /never say a class runs in a summer the Bulletin does not list it for/.test(ARCH) && !/summer course list is not loaded/.test(ARCH));
  check('ARCH rebuilds around summers only through set_plan_shape, and never calls the 9 credits a UGA rule', /set_plan_shape summers rebuilds the board with its summers filled/.test(ARCH) && /never call 9 a UGA limit/.test(ARCH));
  check('ALMA: add_summer adds an empty summer without rebuilding; set_plan_shape summers rebuilds', /add_summer puts an empty summer on the board without rebuilding or moving anything/.test(ALMA) && /set_plan_shape summers rebuilds the whole board around its summers/.test(ALMA));
  check('nothing of Illinois in ARCH\'s prompt', !/Illinois/.test(ARCH));
}

console.log(`\n${passes} passed, ${failures} failed`);
console.log(failures === 0 ? 'ALL SUMMER-TERM CHECKS PASSED' : `${failures} SUMMER-TERM CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
