/**
 * The plan build runs in a worker, and the board it builds there is the
 * board the page would build (plan-build.ts, 2026-11-07).
 *
 * Until 2026-11-07 every Rebuild ran on the page's own thread, and a student
 * who asked for a lighter workload, highly rated teaching or a challenge sat
 * on a frozen page for up to about 22 seconds while the difficulty gate
 * weighed its boards. The build now runs in a worker; only data crosses to
 * it, so what the page handed generatePlan as functions (the UGA board audit,
 * the career matcher, Illinois's prerequisite rule) is made again there from
 * data. Fails when:
 *
 *   1. the data a build reads (the context without its prerequisite rule,
 *      the catalog, the degree) cannot be copied as a worker copies it;
 *   2. a UGA or Illinois student's build on the copy, with Illinois's rule
 *      set again as the worker sets it, differs in any way from the build on
 *      the page's own data: balanced, lightest (the difficulty gate and the
 *      board audit it weighs by) and a spread of the hardest courses;
 *   3. a career matcher remade from its source (careerFitFromSource), after
 *      the copy, reads any course differently from the one it was made from;
 *   4. the workspace builds anywhere but through the worker's client, a board
 *      edit, summer, undo or import lands while a build is under way, ARCH
 *      and ALMA act before the build they asked for is on the board (or an
 *      ALMA turn begun mid-build undoes the Rebuild), another plan tab opened
 *      leaves the build for the tab left running, a failed worker leaves a
 *      build unsettled, or the board takes clicks while it builds.
 *
 *   node lib/planner/__plan-build.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
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
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(await readFile(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, ctx);
  }
`));
const lib = (p) => import(pathToFileURL(join(ROOT, p)).href);
const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const opt = (n) => (existsSync(join(PUBLIC, n)) ? read(n) : null);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => new Response(JSON.stringify(read((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
const U = await lib('components/planner/uga-source.tsx');
const data = await U.loadUgaData();
globalThis.fetch = originalFetch;
const B = await lib('components/planner/plan-build.ts');
const G = await lib('lib/planner/uga-planning-guidance.ts');
const { careerFitFor } = await lib('lib/planner/career-embedding.ts');
const { PRIORITY_PRESETS: P, DEFAULT_PRIORITIES } = await lib('lib/planner/priorities.ts');
const { adaptIllinoisPrograms, illinoisPrereqCheck } = await lib('lib/planner/illinois-data.ts');
const { hydrateIndexRow, toGradeRow, applyOfferings } = await lib('lib/planner/illinois-load.ts');

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? `: ${detail}` : ''}`));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();

// ---- Illinois, as buildContext assembles it (the difficulty-gate check's copy), with illinois-data's rule ----
const meta = read('illinois/meta.json');
const rows = read('illinois/index.json').map(hydrateIndexRow);
const offeringsFile = opt('illinois/offerings.json');
if (offeringsFile) applyOfferings(rows, offeringsFile);
const ilByCode = new Map(rows.map((c) => [norm(c.code), c]));
const ilGrades = new Map(read('illinois/grades.json').map((g) => [norm(g.code), toGradeRow(g, ilByCode.get(norm(g.code))?.title ?? g.code, [])]));
const equivalents = new Map(); for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map(); for (const c of rows) { const max = c.creditsMax ?? c.credits; creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true }); }
const season = (meta.term?.term ?? 'fall').toLowerCase();
const ilContext = {
  courses: rows, prereqs: new Map(Object.entries(read('illinois/prereqs.json'))), grades: ilGrades, equivalents,
  exclusions: new Map(Object.entries(read('illinois/exclusions.json'))), creditRanges, bands: meta.bands,
  offeringPublished: offeringsFile ? new Set(rows.map((c) => norm(c.code))) : new Set(), offerings: offeringsFile ? new Map(Object.entries(offeringsFile.courses)) : undefined,
  offeringTerms: offeringsFile?.terms, languages: opt('illinois/languages.json') ?? undefined,
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  prereqCheck: illinoisPrereqCheck,
};
const summaries = read('illinois/programs.json');

// ---- The students: what composePlan hands the build ----
const ugaStudent = (id) => {
  const program = data.programs.find((p) => p.id === id);
  const emphasisSelections = Object.fromEntries(U.ugaSelectionRequirements(program).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
  const loaded = U.loadUgaProgram(data, program, { emphasisSelections });
  const context = { ...data.context, samplePlanCourses: G.sampleCoursesFor(G.samplePlansFor(data.guidance, [id]), {}) };
  return {
    name: `UGA ${loaded.program.name}`,
    data: { context, catalog: data.courses, loaded, dualLevel: data.dualLevelCourses, languages: null, equivalents: undefined },
    job: (priorities, spreadHard = false) => ({
      input: {
        prior: { known: true, courseCodes: [], exemptCodes: [], unmatchedCredits: 0 },
        horizon: { startSeason: 'Spring', startYear: 2027, gradSeason: 'Fall', gradYear: 2030, stated: true },
        preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities },
        programId: id, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
        degreeTotal: program.totalCredits, interests: '', career: '', programName: loaded.program.name, programCollege: loaded.program.college,
        admissionRoute: null, residency: null, firstYear: false,
      },
      ugaAudit: { priorHours: 0, assumedHours: 0, languagePlaced: null, validation: { minimumTermCredits: 12, maxTermCredits: 18, priorCredits: 0 } },
      transcript: null, doubleDawgs: null, spreadHard, minors: null,
    }),
  };
};
const ilStudent = (id) => {
  const s = summaries.find((p) => p.id === id);
  const blocks = adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [read(`illinois/program/${s.id}.json`)] }, new Map(ilByCode)).blocks.get(s.id) ?? [];
  const loaded = { summary: { id: s.id, name: s.name, totalCredits: s.totalCredits }, program: { name: s.name, college: s.college, totalCredits: s.totalCredits, areas: [] }, blocks, sources: [], urls: [] };
  return {
    name: `Illinois ${s.name}`,
    data: { context: ilContext, catalog: rows, loaded, languages: ilContext.languages ?? null, equivalents },
    job: (priorities, spreadHard = false) => ({
      input: {
        prior: { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish', genEdCredits: [] },
        horizon: { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true },
        preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities },
        programId: s.id, degreeTotal: s.totalCredits || 120, interests: '', career: '', programName: s.name, programCollege: s.college, admissionRoute: null,
        residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' },
      },
      ugaAudit: null, transcript: null, doubleDawgs: null, spreadHard, minors: { heldCodes: [], publishedTotal: s.totalCredits || null },
    }),
  };
};

/** What the worker does with what it is sent (plan-build-client.ts, plan-build.worker.ts): the copy, and Illinois's rule set again. */
function asWorkerHolds(d) {
  const { prereqCheck, ...context } = d.context;
  const copy = structuredClone({ ...d, context });
  return { ...copy, context: prereqCheck ? { ...copy.context, prereqCheck: illinoisPrereqCheck } : copy.context };
}

// ---------------------------------------------------------------------------
console.log('1. The data a build reads can be copied to a worker');
const students = [ugaStudent('69115'), ugaStudent('98779'), ilStudent('engineering/mechanical-engineering-bs')];
const copies = new Map();
for (const st of students) {
  let copy = null;
  try { copy = asWorkerHolds(st.data); } catch (error) { fail(`${st.name}: the data cannot be copied (${error.message})`); continue; }
  copies.set(st, copy);
  ok(`${st.name}: the context, catalog and degree copy`);
}
expect(ilContext.prereqCheck === illinoisPrereqCheck, 'Illinois\'s context holds illinois-data\'s own rule, which the worker sets on its copy');

console.log('\n2. The board built on the copy is the board built on the page\'s data');
const cases = [
  [students[0], 'lightest', P.lightest, true],
  [students[1], 'balanced', DEFAULT_PRIORITIES, false],
  [students[2], 'lightest', P.lightest, false],
  [students[2], 'balanced, spread', DEFAULT_PRIORITIES, true],
];
for (const [st, label, priorities, spread] of cases) {
  const copy = copies.get(st);
  if (!copy) continue;
  const job = st.job(priorities, spread);
  const onPage = B.runPlanBuild(st.data, job, null);
  const inWorker = B.runPlanBuild(copy, structuredClone(job), null);
  const a = JSON.stringify(onPage);
  const b = JSON.stringify(inWorker);
  const codes = (r) => r.generated.terms.map((t) => t.codes.join(',')).join(' | ');
  expect(a === b, `${st.name}, ${label}: the same board, notes and report`, a === b ? '' : `page ${codes(onPage).slice(0, 160)} / worker ${codes(inWorker).slice(0, 160)}`);
  if (label === 'lightest' && st.data.context.schoolId === 'uga') expect(Boolean(onPage.generated.difficulty), `${st.name}, ${label}: the difficulty gate ran (it weighs boards by the audit made in the worker)`);
  // The result crosses back as a copy too.
  expect(JSON.stringify(structuredClone(inWorker)) === b, `${st.name}, ${label}: the result copies back unchanged`);
}

console.log('\n3. The career matcher remade from its source reads every course the same');
{
  const codes = Array.from({ length: 60 }, (_, i) => `TEST ${1000 + i}`);
  const dims = 16;
  const bytes = new Int8Array(codes.length * dims).map((_, k) => ((k * 37) % 255) - 127);
  const vectors = { codes, index: new Map(codes.map((c, i) => [c, i])), bytes, scales: new Float32Array(codes.length).fill(0.01), dims };
  const input = { text: 'I want to be a nurse', vector: Float32Array.from({ length: dims }, (_, k) => Math.sin(k + 1)), school: 'UGA' };
  const fit = { ...careerFitFor(input, vectors), source: { input, vectors } };
  const again = B.careerFitFromSource(structuredClone(fit.source));
  const same = codes.every((c) => fit.strength(c) === again.strength(c) && fit.similarity(c) === again.similarity(c) && fit.reasonFor(c) === again.reasonFor(c) && fit.between(c, codes[0]) === again.between(c, codes[0]));
  expect(same && fit.key === again.key && fit.label === again.label, 'strength, similarity, reasons and closeness match course for course');
}

console.log('\n4. The workspace builds through the worker, and nothing lands on a board being built');
{
  const ws = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  const client = readFileSync(join(ROOT, 'components/planner/plan-build-client.ts'), 'utf8');
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
  const source = readFileSync(join(ROOT, 'components/planner/illinois-source.tsx'), 'utf8');
  expect(!/\bgeneratePlan\(|\bgenerateDoubleDawgs\(|\bholdMaybe\(|\bplanBesideDegree\(/.test(ws), 'the workspace calls no build itself (plan-build.ts does)');
  expect(/await buildPlanApart\(data, job, careerFit \?\? null, \{ board: !trial \}\)/.test(ws), 'composePlan builds through the worker\'s client, a Rebuild replacing any build under way');
  expect(/new Worker\(new URL\('\.\/plan-build\.worker\.ts', import\.meta\.url\)/.test(client), 'the worker is bundled from plan-build.worker.ts');
  expect(/catch \(error\) \{\n\s+\/\/ Data the worker cannot be handed[^\n]*\n\s+console\.warn\([^\n]*\n\s+giveUp\(\);/.test(client) && /made\.onerror = /.test(client), 'a worker that cannot take the data or fails hands the build to the page');
  expect(/if \(run !== buildRun\.current\) return null;\n\s+const now = buildScope\.current;/.test(ws), 'a board that lands after a newer Rebuild, another plan tab or new data is not shown');
  expect(/function boardBusy\(\): boolean \{\n\s+if \(!buildUnderWay\.current\) return false;\n\s+notify\('Your plan is still building'/.test(ws) && /if \(!before \|\| boardBusy\(\)\) return;/.test(ws), 'a board edit while a build is under way is not made');
  // Each starts by asking (2026-11-07 review): a summer added, an undo or an import that a landing build would overwrite, or a "done" said for an edit not made.
  for (const [name, re] of [
    ['add a course', /function addCourse\(courseId: string, termId: string\) \{\n\s+if \(!plan \|\| boardBusy\(\)\) return;/],
    ['move a course', /if \(!plan \|\| targetCourseId === courseId \|\| boardBusy\(\)\) return;/],
    ['add a summer', /function addSummerByHand\(year: number\) \{\n\s+const board = planRef\.current;\n\s+if \(!board \|\| boardBusy\(\)\) return;/],
    ['a summer change, before the shape is saved', /function commitSummer\([^)]*\) \{\n\s+if \(boardBusy\(\)\) return;/],
    ['undo', /function undo\(\) \{\n\s+const entry = undoStack\.at\(-1\);\n\s+if \(!entry \|\| boardBusy\(\)\) return;/],
    ['import a plan', /const file = input\.files\?\.\[0\];\n\s+if \(!file \|\| boardBusy\(\)\) return;/],
    ['re-pick', /onRepick=\{\(\) => \{\n\s+if \(boardBusy\(\)\) return;/],
  ]) expect(re.test(ws), `${name} waits for a build under way`);
  expect(/useEffect\(\(\) => \{\n\s+const under = buildUnderWay\.current;\n\s+if \(!under \|\| under\.tab === activePlanId\) return;[^]*?cancelPlanBuilds\(\);[^]*?\}, \[activePlanId\]\);/.test(ws), 'another plan tab opened stops the build for the plan left, and says so');
  expect(/if \(waited && turn && !turn\.pushed\) \{\n\s+const now = boardNow\(\);/.test(ws), 'an ALMA turn begun while a Rebuild built undoes to the rebuilt board');
  expect(/function giveUp\(first\?: Pending\) \{[^]*?pending\.clear\(\);\n\s+for \(const w of first \? \[first, \.\.\.waiting\] : waiting\) w\.onPage\(\);/.test(client) && !/giveUp\(\);\n\s+runOnPage\(\);/.test(client), 'a worker that fails sends every build still waiting to the page, none left unsettled');
  expect(/const advisorExecute: AdvisorExecutor = async \(name, input, call\) => \{\n[^\n]*\n\s+const waited = Boolean\(buildUnderWay\.current\);\n\s+await whenBuilt\(\);/.test(ws), 'ARCH and ALMA wait for a build under way before they read or change the board');
  expect(/if \(buildUnderWay\.current\?\.compose === composePlan\) return;/.test(ws), 'the same settings asked for again leave the build under way be');
  expect(/\.plan-board-building > \* \{\n\s+opacity: 0\.45;\n\s+pointer-events: none;/.test(css), 'the board takes no clicks while it builds');
  expect(/prereqCheck: illinoisPrereqCheck,/.test(source), 'Illinois\'s context sets illinois-data\'s named rule');
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
