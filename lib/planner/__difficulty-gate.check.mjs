/**
 * Difficulty is weighed, and never costs the degree anything (autoplan.ts
 * difficultyGated, 2026-11-05).
 *
 * Fed into the engine plainly on 2026-11-04, the difficulty estimates from
 * student ratings of the instructors who teach each course made 56 of 483
 * UGA harness boards meet fewer requirements: lighter list picks that no
 * longer met Cultural Diversity (an Advertising freshman), required
 * hardest-band courses pushed off by the per-term cap (Agricultural
 * Engineering's ELEE 4230). The owner's rule: a student who asks for the
 * lightest schedule should get it wherever it costs nothing, and a required
 * course, a later finish or a new warning is never that price. Fails when:
 *
 *   1. the floor context (floorContextOf) is not the context without the
 *      estimates, key for key: at UGA no grades, bands or estimates; at
 *      Illinois the grade-history rows only;
 *   2. for a UGA and an Illinois student, under balanced, lightest and
 *      "Challenge me", the board the student gets places fewer required
 *      courses, meets fewer requirements (UGA: by the board audit too),
 *      finishes later or holds more terms than the board built without the
 *      estimates (difficultyGate: false), which is the board the planner
 *      built before them;
 *   3. under lightest, the student's required courses and finish are worse
 *      than the balanced board's (lighter never costs a requirement);
 *   4. under lightest a board that still stacks two of the hardest courses
 *      in a fall or spring, where the one-a-term board was worse for a
 *      required course or the finish, does not say so in one line, or the
 *      line names where the ratings come from;
 *   5. "Challenge me" does not make the board's own picks harder on average
 *      than balanced's at either school, or lightest does not make them
 *      lighter, or for one student challenge's picks are not harder than
 *      lightest's;
 *   6. the teaching readings from student ratings (course-teaching.ts) are
 *      missing from either school's context or present on its floor, or the
 *      "Highly rated teaching" board is worse than its floor (step 2).
 *
 *   node lib/planner/__difficulty-gate.check.mjs
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
const A = await lib('lib/planner/autoplan.ts');
const G = await lib('lib/planner/uga-planning-guidance.ts');
const { auditUgaBoard } = await lib('components/planner/uga-board-audit.ts');
const { PRIORITY_PRESETS: P } = await lib('lib/planner/priorities.ts');
const { ILLINOIS_RATINGS_IN_PLANS, UGA_DIFFICULTY_IN_PLANS, UGA_TEACHING_IN_PLANS, ILLINOIS_TEACHING_RATINGS_IN_PLANS } = await lib('lib/planner/plan-estimates.ts');
const { adaptIllinoisPrograms, missingPrerequisiteGroups } = await lib('lib/planner/illinois-data.ts');
const { hydrateIndexRow, toGradeRow, applyOfferings } = await lib('lib/planner/illinois-load.ts');

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? `: ${detail}` : ''}`));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();

// ---- Illinois, as buildContext assembles it, the ratings estimates marked ----
const meta = read('illinois/meta.json');
const rows = read('illinois/index.json').map(hydrateIndexRow);
const offeringsFile = opt('illinois/offerings.json');
if (offeringsFile) applyOfferings(rows, offeringsFile);
const ilByCode = new Map(rows.map((c) => [norm(c.code), c]));
const gradeRaw = new Map(read('illinois/grades.json').map((g) => [norm(g.code), g]));
for (const c of rows) { if (!c.gradeFrom) continue; const twin = gradeRaw.get(norm(c.gradeFrom)); if (twin) gradeRaw.set(norm(c.code), twin); }
const ilGrades = new Map(); for (const [code, g] of gradeRaw) ilGrades.set(code, toGradeRow(g, ilByCode.get(code)?.title ?? code, []));
const estimated = new Set();
for (const [code, v] of Object.entries(opt('illinois/course-difficulty-ratings.json')?.courses ?? {})) {
  if (!ILLINOIS_RATINGS_IN_PLANS || ilGrades.has(code)) continue;
  ilGrades.set(code, { code, title: ilByCode.get(code)?.title ?? code, n: 0, sections: 0, gpa: null, aPct: null, dfPct: null, withdrawPct: null, difficulty: v.d, instructors: [] });
  estimated.add(code);
}
const equivalents = new Map(); for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map(); for (const c of rows) { const max = c.creditsMax ?? c.credits; creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true }); }
const sectionsFile = opt('illinois/sections.json');
const sections = new Map((sectionsFile?.courses ?? []).map((row) => [norm(row.code), { ...row, termId: sectionsFile.termId, termLabel: sectionsFile.termLabel }]));
const excellentFile = opt('illinois/excellent.json');
const season = (meta.term?.term ?? 'fall').toLowerCase();
const ilContext = {
  courses: rows, prereqs: new Map(Object.entries(read('illinois/prereqs.json'))), grades: ilGrades, sections, equivalents,
  ...(estimated.size > 0 ? { estimates: { codes: estimated, bands: false } } : {}),
  exclusions: new Map(Object.entries(read('illinois/exclusions.json'))), creditRanges, bands: meta.bands,
  excellent: excellentFile ? new Map(Object.entries(excellentFile.courses)) : undefined, excellentTerms: excellentFile?.terms,
  // Student ratings of the instructors where the list is silent, as illinois-source.tsx buildContext adds them.
  ...(ILLINOIS_TEACHING_RATINGS_IN_PLANS && opt('illinois/course-teaching-ratings.json') ? { teachingRatings: new Map(Object.entries(read('illinois/course-teaching-ratings.json').courses)) } : {}),
  offeringPublished: offeringsFile ? new Set(rows.map((c) => norm(c.code))) : new Set(), offerings: offeringsFile ? new Map(Object.entries(offeringsFile.courses)) : undefined,
  offeringTerms: offeringsFile?.terms, offeringAliases: offeringsFile?.renumbered ? new Map(Object.entries(offeringsFile.renumbered)) : undefined,
  languages: opt('illinois/languages.json') ?? undefined,
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
};
const summaries = read('illinois/programs.json');

// ---------------------------------------------------------------------------
console.log('1. The floor context is the context without the estimates');
expect(UGA_DIFFICULTY_IN_PLANS && ILLINOIS_RATINGS_IN_PLANS, 'both schools\' estimates are on (plan-estimates.ts)');
{
  const ctx = data.context;
  expect(ctx.grades?.size > 4000 && ctx.estimates?.bands === true, 'UGA\'s context carries the estimates, every row and the bands marked', `grades ${ctx.grades?.size}`);
  const floor = A.floorContextOf(ctx);
  expect(!('grades' in floor) && !('bands' in floor) && !('estimates' in floor), 'UGA\'s floor has no grades, bands or estimates keys');
  expect(A.floorContextOf(ctx) === floor, 'the floor is built once a context');
  expect(ctx.grades?.get('MATH 1113E')?.difficulty === ctx.grades?.get('MATH 1113')?.difficulty, 'MATH 1113E takes MATH 1113\'s score (an online twin with none of its own)');
  const il = A.floorContextOf(ilContext);
  expect(estimated.size > 400 && il.grades.size === ilContext.grades.size - estimated.size && [...estimated].every((c) => !il.grades.has(c)), 'Illinois\'s floor keeps the grade-history rows only', `${ilContext.grades.size} -> ${il.grades.size}, ${estimated.size} estimates`);
  // The teaching readings from student ratings (course-teaching.ts) are estimates too: on the context, never on the floor.
  expect(UGA_TEACHING_IN_PLANS && ILLINOIS_TEACHING_RATINGS_IN_PLANS, 'both schools\' teaching readings are on (plan-estimates.ts)');
  expect(ctx.teachingRatings?.size > 2000 && !('teachingRatings' in floor), 'UGA\'s context carries the teaching readings and its floor does not', `${ctx.teachingRatings?.size}`);
  expect(ilContext.teachingRatings?.size > 1000 && !('teachingRatings' in il), 'Illinois\'s context carries the teaching readings and its floor does not');
  const plain = { courses: [], grades: new Map([['A 1', { difficulty: 1 }]]) };
  expect(A.floorContextOf(plain) === plain, 'a context with no estimates is its own floor');
}

// ---------------------------------------------------------------------------
// The students.
const ugaStudent = (id) => {
  const program = data.programs.find((p) => p.id === id);
  const emphasisSelections = Object.fromEntries(U.ugaSelectionRequirements(program).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
  const loaded = U.loadUgaProgram(data, program, { emphasisSelections });
  const context = { ...data.context, samplePlanCourses: G.sampleCoursesFor(G.samplePlansFor(data.guidance, [id]), {}) };
  const audit = (g) => {
    const a = auditUgaBoard({ board: g.plan, context, undergraduate: loaded, priorCodes: [], bookedFor: g.bookedFor, extraCredits: 0, transcript: null, dualLevel: data.dualLevelCourses, validation: { minimumTermCredits: 12, priorCredits: 0 } });
    return a.areas.filter((row) => !row.satisfied).length + a.issues.filter((i) => i.id.startsWith('uga-pool-')).length;
  };
  return {
    name: `UGA ${loaded.program.name}`, requirements: loaded.blocks, context, audit, difficulty: (c) => data.context.grades?.get(c)?.difficulty ?? null,
    input: (priorities, extra = {}) => ({
      requirements: loaded.blocks, context, programName: loaded.program.name, programCollege: loaded.program.college, programId: id,
      prior: { known: true, courseCodes: [], exemptCodes: [], unmatchedCredits: 0 },
      horizon: { startSeason: 'Spring', startYear: 2027, gradSeason: 'Fall', gradYear: 2030, stated: true },
      degreeTotal: program.totalCredits, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
      preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities }, interests: '', career: '', boardAudit: audit, ...extra,
    }),
  };
};
const ilStudent = (id) => {
  const s = summaries.find((p) => p.id === id);
  const blocks = adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [read(`illinois/program/${s.id}.json`)] }, new Map(ilByCode)).blocks.get(s.id) ?? [];
  return {
    name: `Illinois ${s.name}`, requirements: blocks, context: ilContext, audit: null, difficulty: (c) => ilGrades.get(c)?.difficulty ?? null,
    input: (priorities, extra = {}) => ({
      requirements: blocks, context: ilContext, prior: { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish', genEdCredits: [] },
      horizon: { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true },
      preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities },
      programId: s.id, degreeTotal: s.totalCredits || 120, interests: '', career: '', programName: s.name, programCollege: s.college, admissionRoute: null,
      residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' }, ...extra,
    }),
  };
};
// Advertising lost Cultural Diversity to lighter picks on 2026-11-04; Agricultural Engineering stacks hardest-band courses; Mechanical Engineering at Illinois too.
const students = [ugaStudent('98779'), ugaStudent('29981'), ilStudent('engineering/mechanical-engineering-bs')];

const measure = (st, g) => {
  const last = g.terms.reduce((at, t, i) => (t.codes.length > 0 ? i : at), -1);
  const named = new Set(st.requirements.flatMap((r) => (r.rule.kind === 'all' ? r.rule.choices.flatMap((ch) => ch.codes.map(norm)) : [])));
  const track = new Set(g.electives.filter((e) => e.track).map((e) => norm(e.code)));
  const added = new Set(g.addedPrerequisites.map((x) => norm(x.code)));
  const codes = g.terms.flatMap((t) => t.codes.map(norm));
  const picks = codes.filter((c) => !named.has(c) && !track.has(c) && !added.has(c)).map(st.difficulty).filter((d) => d !== null);
  return {
    off: g.notPlaced.length, offCodes: g.notPlaced.map((x) => norm(x.code)), unmet: g.unsatisfied.length, audit: st.audit ? st.audit(g) : 0,
    last, terms: g.terms.length, required: codes.filter((c) => named.has(c)).sort(),
    pickMean: picks.length ? picks.reduce((n, d) => n + d, 0) / picks.length : null,
  };
};
const noWorse = (a, b) => a.off <= b.off && a.offCodes.every((c) => b.offCodes.includes(c)) && a.unmet <= b.unmet && a.audit <= b.audit && a.last <= b.last && a.terms <= b.terms;
const said = (m) => `off ${m.off} [${m.offCodes.join(' ')}], unmet ${m.unmet}, audit ${m.audit}, last term ${m.last} of ${m.terms}, picks ${m.pickMean?.toFixed(1)}`;

// ---------------------------------------------------------------------------
for (const st of students) {
  console.log(`2-5. ${st.name}`);
  const built = {};
  for (const [preset, priorities] of [['balanced', P.balanced], ['lightest', P.lightest], ['challenge', P.challenge], ['teaching', P.teaching]]) {
    const t0 = Date.now();
    const g = A.generatePlan(st.input(priorities));
    const ms = Date.now() - t0;
    const floor = A.generatePlan(st.input(priorities, { difficultyGate: false }));
    const [m, f] = [measure(st, g), measure(st, floor)];
    built[preset] = { g, m, floor: f };
    console.log(`        ${preset}: kept ${g.difficulty?.kept ?? '-'} in ${(ms / 1000).toFixed(1)} s (${g.difficulty?.builds ?? '-'} inner builds; ${(g.difficulty?.tried ?? []).map((t) => `${t.how}${t.worse.length ? ` worse by ${t.worse.join('+')}` : ''}`).join(', ')})`);
    expect(noWorse(m, f), `${preset}: no worse than the board built without the estimates`, `${said(m)} vs ${said(f)}`);
    expect(!g.notes.some((n) => /rate ?my ?prof|\bRMP\b/i.test(n)), `${preset}: no note names where the ratings come from`);
  }
  // Challenge's floor is the balanced board: built without the estimates and with the balanced priorities.
  expect(noWorse(built.challenge.m, built.balanced.floor), 'challenge: no worse than balanced\'s board built without the estimates', `${said(built.challenge.m)} vs ${said(built.balanced.floor)}`);
  const [light, bal] = [built.lightest.m, built.balanced.m];
  expect(light.off <= bal.off && light.unmet <= bal.unmet && light.audit <= bal.audit && light.last <= bal.last, 'lightest: required courses and finish no worse than balanced\'s', `${said(light)} vs ${said(bal)}`);
  const lighter = built.lightest.g.difficulty?.tried.find((t) => t.how === 'lighter');
  const stacked = built.lightest.g.terms.filter((t) => t.season !== 'Summer' && t.codes.filter((c) => (st.difficulty(norm(c)) ?? -1) >= (st.context.bands?.hardest ?? Infinity)).length >= 2);
  const note = built.lightest.g.notes.find((n) => n.startsWith('Lightest schedule:'));
  // Every lightest board still stacking two of the hardest says so, tried or not: a pre-med board past the build budget was told nothing (2026-11-05).
  if (stacked.length > 0) {
    expect(Boolean(note) && stacked.every((t) => note.includes(t.label)), 'lightest: the board says which terms still stack two of the hardest', note ?? 'no note');
  } else {
    ok(`lightest: ${stacked.length} fall or spring terms stack two of the hardest${lighter ? ` (the one-a-term board: ${lighter.worse.join('+') || 'stood'})` : ''}${note ? `; says: ${note}` : ''}`);
  }
  console.log(`        picks, average difficulty: balanced ${bal.pickMean?.toFixed(1)}, lightest ${light.pickMean?.toFixed(1)}, challenge ${built.challenge.m.pickMean?.toFixed(1)}`);
  // The same student asking for a challenge gets harder picks than asking for the lightest schedule.
  expect((built.challenge.m.pickMean ?? 0) > (light.pickMean ?? 0), '"Challenge me" picks harder courses than lightest for the same student', `${built.challenge.m.pickMean?.toFixed(1)} vs ${light.pickMean?.toFixed(1)}`);
  built.st = st;
  st.built = built;
}
// Each school, over its students: challenge harder and lightest lighter than balanced.
for (const school of ['UGA', 'Illinois']) {
  const mine = students.filter((s) => s.name.startsWith(school));
  const mean = (preset) => mine.reduce((n, s) => n + (s.built[preset].m.pickMean ?? 0), 0) / mine.length;
  expect(mean('challenge') > mean('balanced'), `${school}: "Challenge me" makes the board's own picks harder than balanced`, `${mean('challenge').toFixed(1)} vs ${mean('balanced').toFixed(1)}`);
  expect(mean('lightest') < mean('balanced'), `${school}: lightest makes the board's own picks lighter than balanced`, `${mean('lightest').toFixed(1)} vs ${mean('balanced').toFixed(1)}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
